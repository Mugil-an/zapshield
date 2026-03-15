const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const Razorpay = require('razorpay');

const ApiError = require('../utils/apiError');
const { query } = require('../config/db');
const {
  TIER_BASE,
  TIER_MAX_PAYOUT,
} = require('../config/constants');
const {
  getRiderTenureMonths,
  calculateWeeklyPremium,
  buildPremiumExplainer,
  getCoverageWindow,
  getSeasonFactor,
} = require('../services/premium.service');
const {
  buildPagination,
  buildPaginatedResponse,
} = require('../utils/paginationHelper');

const VALID_TIERS = ['basic', 'standard', 'premium'];

function ensureValidTier(tier) {
  if (!VALID_TIERS.includes(tier)) {
    throw ApiError.badRequest('Invalid tier selected');
  }
}

async function getQuote(req, res) {
  const { zone_id: zoneId, tier } = req.body;
  ensureValidTier(tier);

  const zoneResult = await query(
    'SELECT * FROM zones WHERE id = $1 AND is_active = true',
    [zoneId],
  );

  if (!zoneResult.rows.length) {
    throw ApiError.notFound('Zone not found');
  }

  const zone = zoneResult.rows[0];

  const riderResult = await query(
    'SELECT created_at FROM riders WHERE id = $1',
    [req.rider.riderId],
  );

  if (!riderResult.rows.length) {
    throw ApiError.notFound('Rider not found');
  }

  const riderCreatedAt = riderResult.rows[0].created_at;
  const tenureMonths = getRiderTenureMonths(riderCreatedAt);

  const referenceDate = new Date();
  const finalWeeklyPremium = calculateWeeklyPremium(
    tier,
    Number(zone.current_risk_multiplier),
    tenureMonths,
    referenceDate,
  );

  const explainer = buildPremiumExplainer(
    tier,
    Number(zone.current_risk_multiplier),
    tenureMonths,
    referenceDate,
  );

  const { coverage_start, coverage_end } = getCoverageWindow();

  const payload = {
    zone_id: zoneId,
    tier,
    final_weekly_premium: finalWeeklyPremium,
    max_weekly_payout: TIER_MAX_PAYOUT[tier],
    coverage_start,
    coverage_end,
    riderId: req.rider.riderId,
  };

  if (!process.env.JWT_SECRET) {
    throw ApiError.internal('JWT secret not configured');
  }

  const quoteToken = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: '30m',
  });

  const seasonFactorLine = explainer.lines.find((l) =>
    l.label.startsWith('Season adjustment'),
  );
  const season_factor = seasonFactorLine ? getSeasonFactor(referenceDate) : undefined;

  const responseQuote = {
    tier,
    zone: {
      id: zone.id,
      dark_store_name: zone.dark_store_name,
      city: zone.city,
      current_risk_multiplier: Number(zone.current_risk_multiplier),
    },
    base_premium: TIER_BASE[tier],
    zone_risk_multiplier: Number(zone.current_risk_multiplier),
    season_factor,
    tenure_discount_factor: undefined,
    final_weekly_premium: finalWeeklyPremium,
    max_weekly_payout: TIER_MAX_PAYOUT[tier],
    coverage_start,
    coverage_end,
    explainer,
    quote_token: quoteToken,
  };

  return res.json({
    success: true,
    data: {
      quote: responseQuote,
    },
  });
}

async function createRazorpayOrder(req, res) {
  const { zone_id: zoneId, tier } = req.body;
  ensureValidTier(tier);

  const zoneResult = await query(
    'SELECT * FROM zones WHERE id = $1 AND is_active = true',
    [zoneId],
  );

  if (!zoneResult.rows.length) {
    throw ApiError.notFound('Zone not found');
  }

  const zone = zoneResult.rows[0];

  const riderResult = await query(
    'SELECT created_at FROM riders WHERE id = $1',
    [req.rider.riderId],
  );

  if (!riderResult.rows.length) {
    throw ApiError.notFound('Rider not found');
  }

  const tenureMonths = getRiderTenureMonths(riderResult.rows[0].created_at);

  const referenceDate = new Date();
  const finalWeeklyPremium = calculateWeeklyPremium(
    tier,
    Number(zone.current_risk_multiplier),
    tenureMonths,
    referenceDate,
  );

  const amountPaise = finalWeeklyPremium * 100;

  const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });

  const order = await razorpay.orders.create({
    amount: amountPaise,
    currency: 'INR',
    notes: {
      rider_id: req.rider.riderId,
      zone_id: zoneId,
      tier,
    },
  });

  return res.json({
    success: true,
    data: {
      razorpay_order_id: order.id,
      amount_paise: order.amount,
      amount_rupees: finalWeeklyPremium,
      currency: 'INR',
      key_id: process.env.RAZORPAY_KEY_ID,
    },
  });
}

async function bindPolicy(req, res) {
  const {
    quote_token: quoteToken,
    razorpay_order_id: razorpayOrderId,
    razorpay_payment_id: razorpayPaymentId,
    razorpay_signature: razorpaySignature,
  } = req.body;

  let decoded;
  try {
    decoded = jwt.verify(quoteToken, process.env.JWT_SECRET);
  } catch (err) {
    throw ApiError.badRequest('Quote expired, please request a new quote');
  }

  const {
    zone_id: zoneId,
    tier,
    final_weekly_premium: finalWeeklyPremium,
    max_weekly_payout: maxWeeklyPayout,
    coverage_start: coverageStart,
    coverage_end: coverageEnd,
    riderId,
  } = decoded;

  if (riderId !== req.rider.riderId) {
    throw ApiError.forbidden('Quote does not belong to this rider');
  }

  ensureValidTier(tier);

  const existingPolicy = await query(
    `SELECT id
     FROM policies
     WHERE rider_id = $1
       AND status = 'active'
       AND coverage_end > NOW()
     LIMIT 1`,
    [req.rider.riderId],
  );

  if (existingPolicy.rows.length) {
    throw ApiError.badRequest(
      'You already have an active policy this week',
    );
  }

  const body = `${razorpayOrderId}|${razorpayPaymentId}`;
  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(body)
    .digest('hex');

  if (expectedSignature !== razorpaySignature) {
    throw ApiError.badRequest('Payment verification failed');
  }

  const zoneResult = await query(
    'SELECT current_risk_multiplier FROM zones WHERE id = $1 AND is_active = true',
    [zoneId],
  );

  if (!zoneResult.rows.length) {
    throw ApiError.notFound('Zone not found');
  }

  const zone = zoneResult.rows[0];

  const riderResult = await query(
    'SELECT created_at FROM riders WHERE id = $1',
    [req.rider.riderId],
  );

  if (!riderResult.rows.length) {
    throw ApiError.notFound('Rider not found');
  }

  const tenureMonths = getRiderTenureMonths(riderResult.rows[0].created_at);
  const referenceDate = new Date(coverageStart);

  const explainer = buildPremiumExplainer(
    tier,
    Number(zone.current_risk_multiplier),
    tenureMonths,
    referenceDate,
  );

  const seasonLine = explainer.lines.find((l) =>
    l.label.startsWith('Season adjustment'),
  );
  const loyaltyLine = explainer.lines.find(
    (l) => l.label === 'Loyalty discount',
  );

  const season_factor = seasonLine
    ? seasonLine.sign === '+'
      ? 1
      : 1
    : 1;

  const tenure_discount =
    loyaltyLine && loyaltyLine.amount
      ? 1
      : 1;

  const insertResult = await query(
    `INSERT INTO policies (
       rider_id,
       zone_id,
       tier,
       base_premium,
       zone_risk_multiplier,
       season_factor,
       tenure_discount,
       final_weekly_premium,
       max_weekly_payout,
       coverage_start,
       coverage_end,
       status,
       razorpay_order_id,
       razorpay_payment_id,
       payment_verified,
       total_claimed_this_week
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7,
       $8, $9, $10, $11,
       'active', $12, $13, true, 0
     )
     RETURNING *`,
    [
      req.rider.riderId,
      zoneId,
      tier,
      TIER_BASE[tier],
      Number(zone.current_risk_multiplier),
      season_factor,
      tenure_discount,
      finalWeeklyPremium,
      maxWeeklyPayout,
      new Date(coverageStart),
      new Date(coverageEnd),
      razorpayOrderId,
      razorpayPaymentId,
    ],
  );

  const policy = insertResult.rows[0];

  return res.json({
    success: true,
    data: {
      policy: {
        id: policy.id,
        tier: policy.tier,
        coverage_start: policy.coverage_start,
        coverage_end: policy.coverage_end,
        final_weekly_premium: policy.final_weekly_premium,
        max_weekly_payout: policy.max_weekly_payout,
        status: policy.status,
      },
    },
  });
}

async function getPolicies(req, res) {
  const riderId = req.rider.riderId;
  const { status } = req.query;

  const { limit, offset, page } = buildPagination(req.query, 10, 50);

  const params = [riderId];
  let whereClause = 'WHERE p.rider_id = $1';

  if (status) {
    params.push(status);
    whereClause += ` AND p.status = $${params.length}`;
  }

  const policiesPromise = query(
    `SELECT p.*, z.dark_store_name, z.city
     FROM policies p
     JOIN zones z ON p.zone_id = z.id
     ${whereClause}
     ORDER BY p.created_at DESC
     LIMIT $${params.length + 1}
     OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );

  const countPromise = query(
    `SELECT COUNT(*) AS count
     FROM policies p
     ${whereClause}`,
    params,
  );

  const [policiesResult, countResult] = await Promise.all([
    policiesPromise,
    countPromise,
  ]);

  const total = parseInt(countResult.rows[0].count, 10) || 0;

  const paginated = buildPaginatedResponse(
    policiesResult.rows,
    total,
    page,
    limit,
  );

  return res.json({
    success: true,
    data: paginated,
  });
}

async function getActivePolicy(req, res) {
  const riderId = req.rider.riderId;

  const { rows } = await query(
    `SELECT p.*, z.dark_store_name, z.city, z.current_risk_multiplier
     FROM policies p
     JOIN zones z ON p.zone_id = z.id
     WHERE p.rider_id = $1
       AND p.status = 'active'
       AND p.coverage_end > NOW()
     ORDER BY p.created_at DESC
     LIMIT 1`,
    [riderId],
  );

  if (!rows.length) {
    throw ApiError.notFound('No active policy found');
  }

  return res.json({
    success: true,
    data: {
      policy: rows[0],
    },
  });
}

async function getPolicyById(req, res) {
  const { id } = req.params;
  const riderId = req.rider.riderId;

  const policyResult = await query(
    `SELECT p.*, z.dark_store_name, z.city, z.current_risk_multiplier
     FROM policies p
     JOIN zones z ON p.zone_id = z.id
     WHERE p.id = $1
       AND p.rider_id = $2`,
    [id, riderId],
  );

  if (!policyResult.rows.length) {
    throw ApiError.notFound('Policy not found');
  }

  const policy = policyResult.rows[0];

  const claimsResult = await query(
    `SELECT c.*, 
            te.trigger_type,
            te.event_start,
            te.actual_value
     FROM claims c
     JOIN trigger_events te ON c.trigger_event_id = te.id
     WHERE c.policy_id = $1
     ORDER BY c.auto_created_at DESC`,
    [id],
  );

  return res.json({
    success: true,
    data: {
      policy,
      claims: claimsResult.rows,
    },
  });
}

module.exports = {
  getQuote,
  createRazorpayOrder,
  bindPolicy,
  getPolicies,
  getActivePolicy,
  getPolicyById,
};
