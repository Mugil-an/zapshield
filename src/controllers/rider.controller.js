const ApiError = require('../utils/apiError');
const { query } = require('../config/db');

async function getMe(req, res) {
  const riderId = req.rider && req.rider.riderId;

  const { rows } = await query(
    `SELECT r.*, 
            z.dark_store_name,
            z.city,
            z.current_risk_multiplier,
            z.lat,
            z.lng
     FROM riders r
     LEFT JOIN zones z ON r.zone_id = z.id
     WHERE r.id = $1`,
    [riderId],
  );

  if (!rows.length) {
    throw ApiError.notFound('Rider not found');
  }

  return res.json({
    success: true,
    data: {
      rider: rows[0],
    },
  });
}

async function updateMe(req, res) {
  const riderId = req.rider && req.rider.riderId;
  const {
    name,
    partner_id: partnerId,
    aadhaar_last4: aadhaarLast4,
    declared_daily_earnings: declaredDailyEarnings,
    zone_id: zoneId,
  } = req.body;

  const fields = [];
  const values = [];
  let idx = 1;

  if (typeof name !== 'undefined') {
    fields.push(`name = $${idx++}`);
    values.push(name);
  }

  if (typeof partnerId !== 'undefined') {
    fields.push(`partner_id = $${idx++}`);
    values.push(partnerId);
  }

  if (typeof aadhaarLast4 !== 'undefined') {
    fields.push(`aadhaar_last4 = $${idx++}`);
    values.push(aadhaarLast4);
  }

  if (typeof declaredDailyEarnings !== 'undefined') {
    fields.push(`declared_daily_earnings = $${idx++}`);
    values.push(declaredDailyEarnings);
  }

  if (typeof zoneId !== 'undefined') {
    fields.push(`zone_id = $${idx++}`);
    values.push(zoneId);
  }

  // Always update the audit timestamp
  fields.push(`updated_at = NOW()`);

  values.push(riderId);

  const updateSql = `UPDATE riders
                     SET ${fields.join(', ')}
                     WHERE id = $${idx}
                     RETURNING *`;

  const updateResult = await query(updateSql, values);

  if (!updateResult.rows.length) {
    throw ApiError.notFound('Rider not found');
  }

  let updatedRider = updateResult.rows[0];

  if (updatedRider.partner_id && updatedRider.aadhaar_last4) {
    const kycResult = await query(
      `UPDATE riders
       SET kyc_verified = true,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [riderId],
    );

    if (kycResult.rows.length) {
      updatedRider = kycResult.rows[0];
    }
  }

  return res.json({
    success: true,
    data: {
      rider: updatedRider,
    },
  });
}

function computeZoneRiskLevel(multiplier) {
  if (multiplier == null) {
    return null;
  }

  const m = Number(multiplier);

  if (m <= 0.95) return 'low';
  if (m <= 1.15) return 'medium';
  return 'high';
}

async function getDashboard(req, res) {
  const riderId = req.rider && req.rider.riderId;

  const [
    activePolicyResult,
    activeTriggersResult,
    recentPayoutsResult,
    lifetimeStatsResult,
    totalEarnedResult,
  ] = await Promise.all([
    query(
      `SELECT p.*, 
              z.dark_store_name,
              z.city,
              z.current_risk_multiplier
       FROM policies p
       JOIN zones z ON p.zone_id = z.id
       WHERE p.rider_id = $1
         AND p.status = 'active'
         AND p.coverage_end > NOW()
       LIMIT 1`,
      [riderId],
    ),
    query(
      `SELECT te.*
       FROM trigger_events te
       WHERE te.zone_id = (SELECT zone_id FROM riders WHERE id = $1)
         AND te.processed = false
       ORDER BY te.created_at DESC`,
      [riderId],
    ),
    query(
      `SELECT c.*, 
              te.trigger_type,
              te.event_start
       FROM claims c
       JOIN trigger_events te ON c.trigger_event_id = te.id
       WHERE c.rider_id = $1
         AND c.status = 'paid'
       ORDER BY c.payout_completed_at DESC
       LIMIT 5`,
      [riderId],
    ),
    query(
      `SELECT
         COUNT(*) AS policies_count,
         COALESCE(SUM(final_weekly_premium), 0) AS total_premium_paid
       FROM policies
       WHERE rider_id = $1`,
      [riderId],
    ),
    query(
      `SELECT COALESCE(SUM(approved_payout), 0) AS total_earned
       FROM claims
       WHERE rider_id = $1
         AND status = 'paid'`,
      [riderId],
    ),
  ]);

  const activePolicy = activePolicyResult.rows[0] || null;
  const activeTriggers = activeTriggersResult.rows;
  const recentPayouts = recentPayoutsResult.rows;
  const lifetimeStatsRow = lifetimeStatsResult.rows[0] || {
    policies_count: 0,
    total_premium_paid: 0,
  };
  const totalEarnedRow = totalEarnedResult.rows[0] || { total_earned: 0 };

  let coverageRemainingDays = null;
  let zoneMultiplier = null;

  if (activePolicy) {
    const now = new Date();
    const end = new Date(activePolicy.coverage_end);
    const msPerDay = 24 * 60 * 60 * 1000;
    coverageRemainingDays = Math.max(
      0,
      Math.ceil((end.getTime() - now.getTime()) / msPerDay),
    );

    zoneMultiplier = Number(activePolicy.current_risk_multiplier);
  }

  const zoneRiskLevel = computeZoneRiskLevel(zoneMultiplier);

  const riderBasic = {
    id: req.rider.riderId,
    name: req.rider.name,
    mobile: req.rider.mobile,
    kyc_verified: undefined,
  };

  const response = {
    rider: riderBasic,
    active_policy: activePolicy
      ? {
          ...activePolicy,
          coverage_remaining_days: coverageRemainingDays,
        }
      : null,
    zone_risk: {
      level: zoneRiskLevel,
      multiplier: zoneMultiplier,
      active_triggers: activeTriggers,
    },
    recent_payouts: recentPayouts,
    lifetime_stats: {
      policies_count: lifetimeStatsRow.policies_count,
      total_premium_paid: lifetimeStatsRow.total_premium_paid,
      total_earned: totalEarnedRow.total_earned,
      total_protected: activePolicy
        ? Number(activePolicy.max_weekly_payout)
        : 0,
    },
  };

  return res.json({
    success: true,
    data: response,
  });
}

module.exports = {
  getMe,
  updateMe,
  getDashboard,
};
