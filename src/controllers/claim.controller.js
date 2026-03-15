const ApiError = require('../utils/apiError');
const { query } = require('../config/db');
const { buildPagination, buildPaginatedResponse } = require('../utils/paginationHelper');

/**
 * GET /api/claims
 * List all claims for the logged-in rider with pagination
 * Only claims from ACTIVE policies are shown
 */
async function getClaims(req, res) {
  const riderId = req.rider && req.rider.riderId;

  const { limit, offset, page } = buildPagination(req.query, 10, 50);

  // Count total claims for this rider
  const countResult = await query(
    `SELECT COUNT(*) as total
     FROM claims c
     JOIN policies p ON c.policy_id = p.id
     WHERE c.rider_id = $1`,
    [riderId],
  );

  const total = parseInt(countResult.rows[0].total, 10);

  // Retrieve paginated claims with trigger and policy details
  const claimsResult = await query(
    `SELECT c.id,
            c.policy_id,
            c.trigger_event_id,
            c.hourly_rate,
            c.trigger_multiplier,
            c.duration_hours,
            c.calculated_payout,
            c.approved_payout,
            c.fraud_score,
            c.fraud_flags,
            c.status,
            c.razorpay_payout_id,
            c.payout_initiated_at,
            c.payout_completed_at,
            c.auto_created_at,
            c.reviewed_by_admin_id,
            c.reviewed_at,
            te.trigger_type,
            te.event_start,
            te.event_end,
            te.duration_hours as trigger_duration_hours,
            p.tier,
            p.coverage_start,
            p.coverage_end,
            z.dark_store_name,
            z.city
     FROM claims c
     JOIN policies p ON c.policy_id = p.id
     JOIN trigger_events te ON c.trigger_event_id = te.id
     JOIN zones z ON p.zone_id = z.id
     WHERE c.rider_id = $1
     ORDER BY c.auto_created_at DESC
     LIMIT $2 OFFSET $3`,
    [riderId, limit, offset],
  );

  const claimsData = claimsResult.rows.map((row) => ({
    id: row.id,
    policy_id: row.policy_id,
    trigger_event_id: row.trigger_event_id,
    trigger_type: row.trigger_type,
    zone: {
      dark_store_name: row.dark_store_name,
      city: row.city,
    },
    policy: {
      tier: row.tier,
      coverage_start: row.coverage_start,
      coverage_end: row.coverage_end,
    },
    payout: {
      hourly_rate: Number(row.hourly_rate),
      trigger_multiplier: Number(row.trigger_multiplier),
      duration_hours: Number(row.duration_hours),
      calculated_payout: Number(row.calculated_payout),
      approved_payout: Number(row.approved_payout),
    },
    fraud: {
      fraud_score: row.fraud_score !== null ? Number(row.fraud_score) : null,
      fraud_flags: row.fraud_flags || [],
    },
    status: row.status,
    payout_info: {
      razorpay_payout_id: row.razorpay_payout_id,
      payout_initiated_at: row.payout_initiated_at,
      payout_completed_at: row.payout_completed_at,
    },
    audit: {
      auto_created_at: row.auto_created_at,
      reviewed_by_admin_id: row.reviewed_by_admin_id,
      reviewed_at: row.reviewed_at,
    },
  }));

  const paginated = buildPaginatedResponse(claimsData, total, page, limit);

  return res.json({
    success: true,
    data: paginated,
  });
}

/**
 * GET /api/claims/:claimId
 * Retrieve a specific claim with full details
 * Rider can only view their own claims
 */
async function getClaimById(req, res) {
  const riderId = req.rider && req.rider.riderId;
  const { claimId } = req.params;

  const result = await query(
    `SELECT c.id,
            c.policy_id,
            c.trigger_event_id,
            c.hourly_rate,
            c.trigger_multiplier,
            c.duration_hours,
            c.calculated_payout,
            c.approved_payout,
            c.fraud_score,
            c.fraud_flags,
            c.status,
            c.razorpay_payout_id,
            c.payout_initiated_at,
            c.payout_completed_at,
            c.auto_created_at,
            c.reviewed_by_admin_id,
            c.reviewed_at,
            te.trigger_type,
            te.threshold_value,
            te.actual_value,
            te.dispatch_volume_pct,
            te.api_source,
            te.event_start,
            te.event_end,
            te.duration_hours as trigger_duration_hours,
            p.tier,
            p.coverage_start,
            p.coverage_end,
            z.dark_store_name,
            z.city,
            z.current_risk_multiplier
     FROM claims c
     JOIN policies p ON c.policy_id = p.id
     JOIN trigger_events te ON c.trigger_event_id = te.id
     JOIN zones z ON p.zone_id = z.id
     WHERE c.id = $1 AND c.rider_id = $2`,
    [claimId, riderId],
  );

  if (!result.rows.length) {
    throw ApiError.notFound('Claim not found');
  }

  const row = result.rows[0];

  const claim = {
    id: row.id,
    policy_id: row.policy_id,
    trigger_event_id: row.trigger_event_id,
    trigger: {
      type: row.trigger_type,
      threshold_value: Number(row.threshold_value),
      actual_value: Number(row.actual_value),
      dispatch_volume_pct: row.dispatch_volume_pct !== null ? Number(row.dispatch_volume_pct) : null,
      api_source: row.api_source,
      event_window: {
        start: row.event_start,
        end: row.event_end,
        duration_hours: row.trigger_duration_hours !== null ? Number(row.trigger_duration_hours) : null,
      },
    },
    zone: {
      dark_store_name: row.dark_store_name,
      city: row.city,
      risk_multiplier: Number(row.current_risk_multiplier),
    },
    policy: {
      tier: row.tier,
      coverage_start: row.coverage_start,
      coverage_end: row.coverage_end,
    },
    payout_calculation: {
      hourly_rate: Number(row.hourly_rate),
      trigger_multiplier: Number(row.trigger_multiplier),
      duration_hours: Number(row.duration_hours),
      calculated_payout: Number(row.calculated_payout),
      approved_payout: Number(row.approved_payout),
    },
    fraud_assessment: {
      fraud_score: row.fraud_score !== null ? Number(row.fraud_score) : null,
      fraud_flags: row.fraud_flags || [],
    },
    status: row.status,
    payout_details: {
      razorpay_payout_id: row.razorpay_payout_id,
      payout_initiated_at: row.payout_initiated_at,
      payout_completed_at: row.payout_completed_at,
    },
    audit_trail: {
      auto_created_at: row.auto_created_at,
      reviewed_by_admin_id: row.reviewed_by_admin_id,
      reviewed_at: row.reviewed_at,
    },
  };

  return res.json({
    success: true,
    data: {
      claim,
    },
  });
}

module.exports = {
  getClaims,
  getClaimById,
};
