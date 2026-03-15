const ApiError = require('../utils/apiError');
const { query } = require('../config/db');
const { buildPagination, buildPaginatedResponse } = require('../utils/paginationHelper');
const payoutService = require('../services/payout.service');

/**
 * GET /api/admin/dashboard
 * Main insurer dashboard with key metrics
 */
async function getDashboard(req, res) {
  const [
    policyStatsResult,
    claimsStatsResult,
    triggersResult,
    ridersResult,
  ] = await Promise.all([
    // Query 1: Policy stats
    query(
      `SELECT
        COUNT(*) FILTER (WHERE status = 'active'
          AND coverage_end > NOW()) as active_policies,
        COUNT(DISTINCT rider_id) FILTER (
          WHERE status = 'active'
          AND coverage_end > NOW()) as active_riders,
        COALESCE(SUM(final_weekly_premium) FILTER (
          WHERE status = 'active'
          AND coverage_end > NOW()), 0) as weekly_premium_pool
      FROM policies`,
      [],
    ),
    // Query 2: Claims stats (this week)
    query(
      `SELECT
        COUNT(*) FILTER (WHERE status = 'paid'
          AND payout_completed_at > NOW() - INTERVAL '7 days')
          as paid_claims_count,
        COALESCE(SUM(approved_payout) FILTER (
          WHERE status = 'paid'
          AND payout_completed_at > NOW() - INTERVAL '7 days'),
          0) as actual_claims_this_week,
        COUNT(*) FILTER (WHERE status = 'flagged')
          as fraud_queue_count
      FROM claims`,
      [],
    ),
    // Query 3: Active triggers
    query(
      `SELECT COUNT(*) as active_triggers_count
      FROM trigger_events
      WHERE processed = false`,
      [],
    ),
    // Query 4: Total riders
    query(
      `SELECT COUNT(*) as total_riders FROM riders
      WHERE is_active = true`,
      [],
    ),
  ]);

  const policyStats = policyStatsResult.rows[0];
  const claimsStats = claimsStatsResult.rows[0];
  const triggers = triggersResult.rows[0];
  const riders = ridersResult.rows[0];

  const weeklyPremiumPool = Number(policyStats.weekly_premium_pool);
  const actualClaims = Number(claimsStats.actual_claims_this_week);
  const lossRatio =
    weeklyPremiumPool > 0 ? actualClaims / weeklyPremiumPool : 0;
  const combinedRatio = Number((lossRatio + 0.22).toFixed(2));

  return res.json({
    success: true,
    data: {
      total_active_policies: parseInt(policyStats.active_policies, 10),
      total_active_riders: parseInt(policyStats.active_riders, 10),
      total_riders: parseInt(riders.total_riders, 10),
      weekly_premium_pool: Number(weeklyPremiumPool.toFixed(2)),
      expected_claims_this_week: Number(
        (weeklyPremiumPool * 0.65).toFixed(2),
      ),
      actual_claims_this_week: Number(actualClaims.toFixed(2)),
      loss_ratio: Number(lossRatio.toFixed(2)),
      combined_ratio: combinedRatio,
      fraud_queue_count: parseInt(claimsStats.fraud_queue_count, 10),
      active_triggers_count: parseInt(triggers.active_triggers_count, 10),
    },
  });
}

/**
 * GET /api/admin/zones/risk-map
 * Zone risk assessment with active policies and triggers
 */
async function getZoneRiskMap(req, res) {
  const result = await query(
    `SELECT z.*,
      COUNT(DISTINCT p.id) FILTER (
        WHERE p.status = 'active'
        AND p.coverage_end > NOW()) as active_policies_count,
      COUNT(DISTINCT te.id) FILTER (
        WHERE te.processed = false) as active_triggers_count,
      CASE
        WHEN z.current_risk_multiplier <= 0.95 THEN 'low'
        WHEN z.current_risk_multiplier <= 1.15 THEN 'medium'
        ELSE 'high'
      END as risk_level
    FROM zones z
    LEFT JOIN policies p ON p.zone_id = z.id
    LEFT JOIN trigger_events te ON te.zone_id = z.id
    WHERE z.is_active = true
    GROUP BY z.id
    ORDER BY z.current_risk_multiplier DESC`,
    [],
  );

  const zones = result.rows.map((row) => ({
    id: row.id,
    dark_store_name: row.dark_store_name,
    city: row.city,
    lat: Number(row.lat),
    lng: Number(row.lng),
    radius_meters: row.radius_meters,
    current_risk_multiplier: Number(row.current_risk_multiplier),
    active_policies_count: parseInt(row.active_policies_count, 10),
    active_triggers_count: parseInt(row.active_triggers_count, 10),
    risk_level: row.risk_level,
  }));

  const highRiskCount = zones.filter((z) => z.risk_level === 'high').length;
  const mediumRiskCount = zones.filter((z) => z.risk_level === 'medium').length;
  const lowRiskCount = zones.filter((z) => z.risk_level === 'low').length;

  return res.json({
    success: true,
    data: {
      zones,
      summary: {
        high_risk_count: highRiskCount,
        medium_risk_count: mediumRiskCount,
        low_risk_count: lowRiskCount,
        total_zones: zones.length,
      },
    },
  });
}

/**
 * GET /api/admin/claims
 * Paginated list of all claims with filters
 */
async function getAdminClaims(req, res) {
  const { status, zone_id: zoneId } = req.query;
  const { limit, offset, page } = buildPagination(req.query, 25, 100);

  const whereConditions = ['1=1'];
  const params = [];

  if (status) {
    whereConditions.push(`claims.status = $${params.length + 1}`);
    params.push(status);
  }

  if (zoneId) {
    whereConditions.push(`trigger_events.zone_id = $${params.length + 1}`);
    params.push(zoneId);
  }

  const countResult = await query(
    `SELECT COUNT(*) as total FROM claims
    JOIN trigger_events ON claims.trigger_event_id = trigger_events.id
    WHERE ${whereConditions.join(' AND ')}`,
    params,
  );

  const total = parseInt(countResult.rows[0].total, 10);

  const claimsResult = await query(
    `SELECT claims.*,
      riders.mobile, riders.name as rider_name,
      trigger_events.trigger_type,
      trigger_events.event_start,
      trigger_events.actual_value,
      trigger_events.dispatch_volume_pct,
      zones.dark_store_name, zones.city,
      policies.tier
    FROM claims
    JOIN riders ON claims.rider_id = riders.id
    JOIN trigger_events ON claims.trigger_event_id = trigger_events.id
    JOIN zones ON trigger_events.zone_id = zones.id
    JOIN policies ON claims.policy_id = policies.id
    WHERE ${whereConditions.join(' AND ')}
    ORDER BY claims.auto_created_at DESC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );

  const claimsData = claimsResult.rows.map((row) => ({
    id: row.id,
    rider: {
      id: row.rider_id,
      mobile: row.mobile,
      name: row.rider_name,
    },
    zone: {
      dark_store_name: row.dark_store_name,
      city: row.city,
    },
    policy: {
      tier: row.tier,
    },
    trigger: {
      type: row.trigger_type,
      event_start: row.event_start,
      actual_value: Number(row.actual_value),
      dispatch_volume_pct:
        row.dispatch_volume_pct !== null
          ? Number(row.dispatch_volume_pct)
          : null,
    },
    payout: {
      calculated_payout: Number(row.calculated_payout),
      approved_payout: Number(row.approved_payout),
    },
    fraud_score: row.fraud_score !== null ? Number(row.fraud_score) : null,
    status: row.status,
    auto_created_at: row.auto_created_at,
  }));

  const paginated = buildPaginatedResponse(
    claimsData,
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
 * PATCH /api/admin/claims/:id/review
 * Review flagged claims (approve or reject)
 */
async function reviewClaim(req, res) {
  const { id: claimId } = req.params;
  const { action, notes } = req.body;
  const adminId = req.admin && req.admin.adminId;

  if (!['approve', 'reject'].includes(action)) {
    throw ApiError.badRequest('Action must be approve or reject');
  }

  const claimResult = await query('SELECT * FROM claims WHERE id = $1', [
    claimId,
  ]);

  if (!claimResult.rows.length) {
    throw ApiError.notFound('Claim not found');
  }

  const claim = claimResult.rows[0];

  if (claim.status !== 'flagged') {
    throw ApiError.badRequest('Only flagged claims can be reviewed');
  }

  let updatedClaim;

  if (action === 'approve') {
    const updateResult = await query(
      `UPDATE claims SET
        status = 'approved',
        approved_payout = calculated_payout,
        reviewed_by_admin_id = $1,
        reviewed_at = NOW()
      WHERE id = $2
      RETURNING *`,
      [adminId, claimId],
    );

    updatedClaim = updateResult.rows[0];

    // Initiate payout
    const riderResult = await query('SELECT * FROM riders WHERE id = $1', [
      updatedClaim.rider_id,
    ]);

    if (riderResult.rows.length) {
      const rider = riderResult.rows[0];
      await payoutService.initiatePayout(updatedClaim, rider);
    }
  } else {
    // reject
    const updateResult = await query(
      `UPDATE claims SET
        status = 'rejected',
        approved_payout = 0,
        reviewed_by_admin_id = $1,
        reviewed_at = NOW()
      WHERE id = $2
      RETURNING *`,
      [adminId, claimId],
    );

    updatedClaim = updateResult.rows[0];
  }

  return res.json({
    success: true,
    data: {
      claim: updatedClaim,
    },
  });
}

/**
 * GET /api/admin/analytics/loss-ratio
 * Weekly loss ratio trends
 */
async function getLossRatioAnalytics(req, res) {
  const weeksParam = req.query.weeks ? parseInt(req.query.weeks, 10) : 8;
  const weeks = Math.min(weeksParam, 26);

  const result = await query(
    `SELECT
      DATE_TRUNC('week', coverage_start) as week_start,
      COUNT(*) as policies_count,
      COALESCE(SUM(final_weekly_premium), 0) as premium_collected,
      COALESCE(SUM(total_claimed_this_week), 0) as claims_paid,
      CASE
        WHEN SUM(final_weekly_premium) > 0
        THEN ROUND(SUM(total_claimed_this_week) /
             SUM(final_weekly_premium), 4)
        ELSE 0
      END as loss_ratio
    FROM policies
    WHERE coverage_start > NOW() - ($1 || ' weeks')::interval
    GROUP BY DATE_TRUNC('week', coverage_start)
    ORDER BY week_start DESC`,
    [weeks],
  );

  const analytics = result.rows.map((row) => {
    const lossRatio = Number(row.loss_ratio);
    const combinedRatio = Number((lossRatio + 0.22).toFixed(2));
    return {
      week_start: row.week_start,
      policies_count: parseInt(row.policies_count, 10),
      premium_collected: Number(row.premium_collected),
      claims_paid: Number(row.claims_paid),
      loss_ratio: lossRatio,
      combined_ratio: combinedRatio,
    };
  });

  const avgLossRatio =
    analytics.length > 0
      ? Number(
          (
            analytics.reduce((sum, a) => sum + a.loss_ratio, 0) /
            analytics.length
          ).toFixed(2),
        )
      : 0;

  const avgPremiumPerWeek =
    analytics.length > 0
      ? Number(
          (
            analytics.reduce((sum, a) => sum + a.premium_collected, 0) /
            analytics.length
          ).toFixed(2),
        )
      : 0;

  return res.json({
    success: true,
    data: {
      weeks_analyzed: weeks,
      analytics,
      averages: {
        avg_loss_ratio: avgLossRatio,
        avg_combined_ratio: Number((avgLossRatio + 0.22).toFixed(2)),
        avg_premium_per_week: avgPremiumPerWeek,
      },
    },
  });
}

/**
 * GET /api/admin/analytics/trigger-frequency
 * Breakdown of trigger events by type
 */
async function getTriggerFrequency(req, res) {
  const weeksParam = req.query.weeks ? parseInt(req.query.weeks, 10) : 8;
  const weeks = Math.min(weeksParam, 26);
  const { zone_id: zoneId } = req.query;

  const params = [weeks];
  let whereClause = 'created_at > NOW() - ($1 || \' weeks\')::interval';

  if (zoneId) {
    whereClause += ` AND zone_id = $${params.length + 1}`;
    params.push(zoneId);
  }

  const result = await query(
    `SELECT
      trigger_type,
      COUNT(*) as event_count,
      AVG(CASE WHEN claims_generated > 0
          THEN claims_generated END) as avg_claims_per_event,
      MAX(created_at) as last_occurred
    FROM trigger_events
    WHERE ${whereClause}
    GROUP BY trigger_type
    ORDER BY event_count DESC`,
    params,
  );

  const triggerFrequency = result.rows.map((row) => ({
    trigger_type: row.trigger_type,
    event_count: parseInt(row.event_count, 10),
    avg_claims_per_event:
      row.avg_claims_per_event !== null
        ? Number(row.avg_claims_per_event.toFixed(2))
        : 0,
    last_occurred: row.last_occurred,
  }));

  return res.json({
    success: true,
    data: {
      trigger_frequency: triggerFrequency,
      weeks_analyzed: weeks,
    },
  });
}

/**
 * GET /api/admin/riders
 * Rider directory with policy and claim aggregates
 */
async function getAdminRiders(req, res) {
  const { zone_id: zoneId, kyc_verified: kycVerifiedParam } = req.query;
  const { limit, offset, page } = buildPagination(req.query, 25, 100);

  const whereConditions = ['riders.is_active = true'];
  const params = [];

  if (zoneId) {
    whereConditions.push(`riders.zone_id = $${params.length + 1}`);
    params.push(zoneId);
  }

  if (kycVerifiedParam !== undefined) {
    const kycBool = kycVerifiedParam === 'true';
    whereConditions.push(`riders.kyc_verified = $${params.length + 1}`);
    params.push(kycBool);
  }

  const countResult = await query(
    `SELECT COUNT(DISTINCT riders.id) as total FROM riders
    WHERE ${whereConditions.join(' AND ')}`,
    params,
  );

  const total = parseInt(countResult.rows[0].total, 10);

  const ridersResult = await query(
    `SELECT riders.*,
      zones.dark_store_name, zones.city,
      COUNT(DISTINCT p.id) as total_policies,
      COUNT(DISTINCT c.id) as total_claims,
      COALESCE(SUM(c.approved_payout)
        FILTER (WHERE c.status = 'paid'), 0) as total_paid_out
    FROM riders
    LEFT JOIN zones ON riders.zone_id = zones.id
    LEFT JOIN policies p ON p.rider_id = riders.id
    LEFT JOIN claims c ON c.rider_id = riders.id
    WHERE ${whereConditions.join(' AND ')}
    GROUP BY riders.id, zones.dark_store_name, zones.city
    ORDER BY riders.created_at DESC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );

  const ridersData = ridersResult.rows.map((row) => ({
    id: row.id,
    mobile: row.mobile,
    name: row.name,
    zone: row.dark_store_name
      ? {
          dark_store_name: row.dark_store_name,
          city: row.city,
        }
      : null,
    kyc_verified: row.kyc_verified,
    declared_daily_earnings: row.declared_daily_earnings
      ? Number(row.declared_daily_earnings)
      : null,
    total_policies: parseInt(row.total_policies, 10),
    total_claims: parseInt(row.total_claims, 10),
    total_paid_out: Number(row.total_paid_out),
    created_at: row.created_at,
  }));

  const paginated = buildPaginatedResponse(
    ridersData,
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
 * GET /api/admin/fraud-queue
 * All flagged claims awaiting insurer review
 */
async function getFraudQueue(req, res) {
  const result = await query(
    `SELECT claims.*,
      riders.mobile, riders.name as rider_name,
      trigger_events.trigger_type,
      trigger_events.event_start,
      trigger_events.dispatch_volume_pct,
      zones.dark_store_name,
      policies.tier,
      policies.final_weekly_premium
    FROM claims
    JOIN riders ON claims.rider_id = riders.id
    JOIN trigger_events ON claims.trigger_event_id = trigger_events.id
    JOIN zones ON trigger_events.zone_id = zones.id
    JOIN policies ON claims.policy_id = policies.id
    WHERE claims.status = 'flagged'
    ORDER BY claims.fraud_score DESC`,
    [],
  );

  const queue = result.rows.map((row) => ({
    id: row.id,
    rider: {
      id: row.rider_id,
      mobile: row.mobile,
      name: row.rider_name,
    },
    zone: {
      dark_store_name: row.dark_store_name,
    },
    policy: {
      tier: row.tier,
      final_weekly_premium: Number(row.final_weekly_premium),
    },
    trigger: {
      type: row.trigger_type,
      event_start: row.event_start,
      dispatch_volume_pct:
        row.dispatch_volume_pct !== null
          ? Number(row.dispatch_volume_pct)
          : null,
    },
    fraud_assessment: {
      fraud_score: row.fraud_score !== null ? Number(row.fraud_score) : null,
      fraud_flags: row.fraud_flags || [],
    },
    payout: {
      calculated_payout: Number(row.calculated_payout),
      approved_payout: Number(row.approved_payout),
    },
    auto_created_at: row.auto_created_at,
  }));

  return res.json({
    success: true,
    data: {
      queue,
      count: queue.length,
    },
  });
}

module.exports = {
  getDashboard,
  getZoneRiskMap,
  getAdminClaims,
  reviewClaim,
  getLossRatioAnalytics,
  getTriggerFrequency,
  getAdminRiders,
  getFraudQueue,
};
