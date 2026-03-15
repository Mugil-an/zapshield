const ApiError = require('../utils/apiError');
const { query } = require('../config/db');
const {
  TRIGGER_THRESHOLDS,
  TRIGGER_MULTIPLIER,
  TIER_HOURLY_RATE,
} = require('../config/constants');
const { buildPagination, buildPaginatedResponse } = require('../utils/paginationHelper');
const { processTriggerDirect } = require('../services/trigger.engine');

/**
 * Helper: Get threshold value for trigger type
 */
function getThresholdForType(triggerType) {
  switch (triggerType) {
    case 'rain_burst':
      return TRIGGER_THRESHOLDS.RAIN_MM;
    case 'extreme_heat':
      return TRIGGER_THRESHOLDS.HEAT_CELSIUS;
    case 'severe_aqi':
      return TRIGGER_THRESHOLDS.AQI;
    case 'store_closure':
      return 1;
    case 'curfew':
      return 1;
    default:
      return 0;
  }
}

/**
 * POST /api/triggers/simulate
 * Manually fire a trigger event for demo/testing
 * Full pipeline: dedup → insert → find riders → fraud check → claims → payouts
 */
async function simulate(req, res) {
  const {
    zone_id: zoneId,
    trigger_type: triggerType,
    actual_value: actualValue,
    duration_hours: durationHours = 1.0,
    dispatch_volume_pct: dispatchVolumePct = 20,
  } = req.body;

  const adminEmail = req.admin && req.admin.email;

  // Fetch zone
  const zoneResult = await query(
    'SELECT * FROM zones WHERE id = $1 AND is_active = true',
    [zoneId],
  );

  if (!zoneResult.rows.length) {
    throw ApiError.notFound('Zone not found');
  }

  const zone = zoneResult.rows[0];

  // Build trigger data
  const triggerData = {
    triggered: true,
    trigger_type: triggerType,
    actual_value: actualValue,
    threshold_value: getThresholdForType(triggerType),
    duration_hours: durationHours,
    api_source: 'manual-simulation',
    dispatch_volume_pct: dispatchVolumePct,
    raw_response: {
      simulated: true,
      simulated_by: adminEmail,
      simulated_at: new Date().toISOString(),
      note: 'Manual trigger for demo/testing purposes',
    },
  };

  // Build mock store status
  const storeStatus = {
    store_open: dispatchVolumePct > 40,
    dispatch_volume_pct: dispatchVolumePct,
    store_name: zone.dark_store_name,
    source: 'manual-simulation',
  };

  // Process the trigger (full pipeline)
  await processTriggerDirect(zone, triggerData, storeStatus);

  // Fetch trigger event and aggregates
  const triggerEventResult = await query(
    `SELECT trigger_events.*,
      COUNT(claims.id) as total_claims,
      COUNT(claims.id) FILTER (
        WHERE claims.status = 'paid') as paid_claims,
      COUNT(claims.id) FILTER (
        WHERE claims.status = 'flagged') as flagged_claims,
      COALESCE(SUM(claims.approved_payout)
        FILTER (WHERE claims.status = 'paid'), 0)
        as total_payout_amount
    FROM trigger_events
    LEFT JOIN claims
      ON claims.trigger_event_id = trigger_events.id
    WHERE trigger_events.zone_id = $1
      AND trigger_events.trigger_type = $2
      AND trigger_events.api_source = 'manual-simulation'
    GROUP BY trigger_events.id
    ORDER BY trigger_events.created_at DESC
    LIMIT 1`,
    [zoneId, triggerType],
  );

  if (!triggerEventResult.rows.length) {
    throw ApiError.internal('Trigger event not created');
  }

  const triggerEvent = triggerEventResult.rows[0];

  // Fetch associated claims
  const claimsResult = await query(
    `SELECT claims.*,
      riders.name as rider_name,
      riders.mobile
    FROM claims
    JOIN riders ON claims.rider_id = riders.id
    WHERE claims.trigger_event_id = $1
    ORDER BY claims.auto_created_at DESC`,
    [triggerEvent.id],
  );

  const claimsData = claimsResult.rows.map((row) => ({
    claim_id: row.id,
    rider_name: row.rider_name,
    mobile: row.mobile,
    approved_payout: Number(row.approved_payout),
    fraud_score: row.fraud_score !== null ? Number(row.fraud_score) : null,
    fraud_flags: row.fraud_flags || [],
    status: row.status,
    payout_id: row.razorpay_payout_id,
  }));

  const totalClaims = parseInt(triggerEvent.total_claims, 10);
  const paidClaims = parseInt(triggerEvent.paid_claims, 10);
  const flaggedClaims = parseInt(triggerEvent.flagged_claims, 10);
  const totalPayoutAmount = Number(triggerEvent.total_payout_amount);

  return res.json({
    success: true,
    data: {
      simulation: {
        zone: {
          id: zone.id,
          dark_store_name: zone.dark_store_name,
          city: zone.city,
        },
        trigger_type: triggerType,
        actual_value: actualValue,
        duration_hours: durationHours,
        dispatch_volume_pct: dispatchVolumePct,
        simulated_by: adminEmail,
        simulated_at: new Date().toISOString(),
      },
      results: {
        trigger_event_id: triggerEvent.id,
        total_claims_generated: totalClaims,
        paid_claims: paidClaims,
        flagged_claims: flaggedClaims,
        total_payout_amount: Number(totalPayoutAmount.toFixed(2)),
        claims: claimsData,
      },
      message: `Simulation complete. ${totalClaims} claim(s) generated, ${paidClaims} paid out automatically.`,
    },
  });
}

/**
 * GET /api/triggers
 * List all trigger events with pagination and filters
 */
async function getTriggers(req, res) {
  const { zone_id: zoneId, type, processed } = req.query;
  const { limit, offset, page } = buildPagination(req.query, 25, 100);

  const whereConditions = [];
  const params = [];

  if (zoneId) {
    whereConditions.push(`zone_id = $${params.length + 1}`);
    params.push(zoneId);
  }

  if (type) {
    whereConditions.push(`trigger_type = $${params.length + 1}`);
    params.push(type);
  }

  if (processed !== undefined) {
    const processedBool = processed === 'true';
    whereConditions.push(`processed = $${params.length + 1}`);
    params.push(processedBool);
  }

  const whereClause =
    whereConditions.length > 0 ? whereConditions.join(' AND ') : '1=1';

  const countResult = await query(
    `SELECT COUNT(*) as total FROM trigger_events WHERE ${whereClause}`,
    params,
  );

  const total = parseInt(countResult.rows[0].total, 10);

  const triggersResult = await query(
    `SELECT trigger_events.*,
      COUNT(claims.id) as claims_count
    FROM trigger_events
    LEFT JOIN claims ON claims.trigger_event_id = trigger_events.id
    WHERE ${whereClause}
    GROUP BY trigger_events.id
    ORDER BY trigger_events.created_at DESC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );

  const triggersData = triggersResult.rows.map((row) => ({
    id: row.id,
    zone_id: row.zone_id,
    trigger_type: row.trigger_type,
    actual_value: Number(row.actual_value),
    threshold_value: Number(row.threshold_value),
    dispatch_volume_pct:
      row.dispatch_volume_pct !== null ? Number(row.dispatch_volume_pct) : null,
    api_source: row.api_source,
    event_start: row.event_start,
    event_end: row.event_end,
    duration_hours:
      row.duration_hours !== null ? Number(row.duration_hours) : null,
    processed: row.processed,
    claims_generated: row.claims_generated,
    claims_count: parseInt(row.claims_count, 10),
    created_at: row.created_at,
  }));

  const paginated = buildPaginatedResponse(
    triggersData,
    total,
    page,
    limit,
  );

  return res.json({
    success: true,
    data: paginated,
  });
}

/**
 * GET /api/triggers/:id
 * Fetch a single trigger event with associated claims
 */
async function getTriggerById(req, res) {
  const { id: triggerId } = req.params;

  const triggerResult = await query(
    `SELECT trigger_events.*,
      COUNT(claims.id) as claims_count
    FROM trigger_events
    LEFT JOIN claims ON claims.trigger_event_id = trigger_events.id
    WHERE trigger_events.id = $1
    GROUP BY trigger_events.id`,
    [triggerId],
  );

  if (!triggerResult.rows.length) {
    throw ApiError.notFound('Trigger event not found');
  }

  const row = triggerResult.rows[0];

  const trigger = {
    id: row.id,
    zone_id: row.zone_id,
    trigger_type: row.trigger_type,
    actual_value: Number(row.actual_value),
    threshold_value: Number(row.threshold_value),
    dispatch_volume_pct:
      row.dispatch_volume_pct !== null ? Number(row.dispatch_volume_pct) : null,
    api_source: row.api_source,
    raw_api_response: row.raw_api_response,
    event_window: {
      start: row.event_start,
      end: row.event_end,
      duration_hours:
        row.duration_hours !== null ? Number(row.duration_hours) : null,
    },
    processed: row.processed,
    processed_at: row.processed_at,
    claims_generated: row.claims_generated,
    claims_count: parseInt(row.claims_count, 10),
    created_at: row.created_at,
  };

  // Fetch claims for this trigger
  const claimsResult = await query(
    `SELECT claims.*,
      riders.name as rider_name,
      riders.mobile,
      policies.tier
    FROM claims
    JOIN riders ON claims.rider_id = riders.id
    JOIN policies ON claims.policy_id = policies.id
    WHERE claims.trigger_event_id = $1
    ORDER BY claims.auto_created_at DESC`,
    [triggerId],
  );

  const claims = claimsResult.rows.map((c) => ({
    id: c.id,
    rider: {
      id: c.rider_id,
      name: c.rider_name,
      mobile: c.mobile,
    },
    policy_tier: c.tier,
    payout: {
      hourly_rate: Number(c.hourly_rate),
      trigger_multiplier: Number(c.trigger_multiplier),
      duration_hours: Number(c.duration_hours),
      calculated_payout: Number(c.calculated_payout),
      approved_payout: Number(c.approved_payout),
    },
    fraud: {
      fraud_score: c.fraud_score !== null ? Number(c.fraud_score) : null,
      fraud_flags: c.fraud_flags || [],
    },
    status: c.status,
    payout_id: c.razorpay_payout_id,
    created_at: c.auto_created_at,
  }));

  return res.json({
    success: true,
    data: {
      trigger,
      claims,
    },
  });
}

module.exports = {
  simulate,
  getTriggers,
  getTriggerById,
};
