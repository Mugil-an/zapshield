const { query } = require('../config/db');
const {
  buildPagination,
  buildPaginatedResponse,
} = require('../utils/paginationHelper');

async function getPayouts(req, res) {
  const riderId = req.rider.riderId;
  const { limit, offset, page } = buildPagination(req.query, 20, 50);

  const payoutsPromise = query(
    `SELECT claims.id,
            claims.approved_payout,
            claims.razorpay_payout_id,
            claims.payout_completed_at,
            claims.fraud_score,
            trigger_events.trigger_type,
            trigger_events.event_start,
            trigger_events.zone_id,
            zones.dark_store_name
     FROM claims
     JOIN trigger_events ON claims.trigger_event_id = trigger_events.id
     JOIN zones ON trigger_events.zone_id = zones.id
     WHERE claims.rider_id = $1
       AND claims.status = 'paid'
     ORDER BY claims.payout_completed_at DESC
     LIMIT $2 OFFSET $3`,
    [riderId, limit, offset],
  );

  const countPromise = query(
    `SELECT COUNT(*) AS count
     FROM claims
     WHERE rider_id = $1
       AND status = 'paid'`,
    [riderId],
  );

  const [payoutsResult, countResult] = await Promise.all([
    payoutsPromise,
    countPromise,
  ]);

  const total = parseInt(countResult.rows[0].count, 10) || 0;
  const paginated = buildPaginatedResponse(
    payoutsResult.rows,
    total,
    page,
    limit,
  );

  return res.json({
    success: true,
    data: paginated,
  });
}

async function getPayoutSummary(req, res) {
  const riderId = req.rider.riderId;

  const totalPromise = query(
    `SELECT COALESCE(SUM(approved_payout), 0) AS total_earned,
            COUNT(*) AS total_payouts
     FROM claims
     WHERE rider_id = $1
       AND status = 'paid'`,
    [riderId],
  );

  const weekPromise = query(
    `SELECT COALESCE(SUM(approved_payout), 0) AS this_week_earned
     FROM claims
     WHERE rider_id = $1
       AND status = 'paid'
       AND payout_completed_at > NOW() - INTERVAL '7 days'`,
    [riderId],
  );

  const pendingPromise = query(
    `SELECT COUNT(*) AS pending_count,
            COALESCE(SUM(calculated_payout), 0) AS pending_amount
     FROM claims
     WHERE rider_id = $1
       AND status IN ('approved', 'pending_fraud_check')`,
    [riderId],
  );

  const [totalRes, weekRes, pendingRes] = await Promise.all([
    totalPromise,
    weekPromise,
    pendingPromise,
  ]);

  const totalRow = totalRes.rows[0];
  const weekRow = weekRes.rows[0];
  const pendingRow = pendingRes.rows[0];

  return res.json({
    success: true,
    data: {
      total_earned: Number(totalRow.total_earned),
      total_payouts: parseInt(totalRow.total_payouts, 10) || 0,
      this_week_earned: Number(weekRow.this_week_earned),
      pending_count: parseInt(pendingRow.pending_count, 10) || 0,
      pending_amount: Number(pendingRow.pending_amount),
    },
  });
}

module.exports = {
  getPayouts,
  getPayoutSummary,
};
