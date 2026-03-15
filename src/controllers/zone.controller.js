const ApiError = require('../utils/apiError');
const { query } = require('../config/db');

function computeRiskLevel(multiplier) {
  if (multiplier == null) return null;
  const m = Number(multiplier);
  if (m <= 0.95) return 'low';
  if (m <= 1.15) return 'medium';
  return 'high';
}

async function getAllZones(req, res) {
  const { city, lat, lng, radius } = req.query;

  const conditions = ['is_active = true'];
  const params = [];
  let paramIndex = 1;

  if (city) {
    conditions.push(`city ILIKE $${paramIndex}`);
    params.push(city);
    paramIndex += 1;
  }

  let distanceExpr = null;
  if (lat && lng && radius) {
    distanceExpr =
      '6371000 * acos(cos(radians($' +
      paramIndex +
      ')) * cos(radians(lat)) * cos(radians(lng) - radians($' +
      (paramIndex + 1) +
      ')) + sin(radians($' +
      paramIndex +
      ')) * sin(radians(lat)))';
    conditions.push(`${distanceExpr} <= $${paramIndex + 2}`);
    params.push(lat, lng, radius);
    paramIndex += 3;
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await query(
    `SELECT * FROM zones
     ${whereClause}
     ORDER BY created_at ASC`,
    params,
  );

  const zones = rows.map((z) => ({
    ...z,
    risk_level: computeRiskLevel(z.current_risk_multiplier),
  }));

  return res.json({
    success: true,
    data: {
      zones,
      count: zones.length,
    },
  });
}

async function getZoneById(req, res) {
  const { id } = req.params;

  const zoneResult = await query(
    `SELECT z.*,
            COUNT(DISTINCT p.id) FILTER (WHERE p.status = 'active') AS active_policies_count,
            COUNT(DISTINCT te.id) FILTER (WHERE te.processed = false) AS active_triggers_count
     FROM zones z
     LEFT JOIN policies p ON p.zone_id = z.id
     LEFT JOIN trigger_events te ON te.zone_id = z.id
     WHERE z.id = $1
     GROUP BY z.id`,
    [id],
  );

  if (!zoneResult.rows.length) {
    throw ApiError.notFound('Zone not found');
  }

  const zoneRow = zoneResult.rows[0];

  const triggersResult = await query(
    `SELECT *
     FROM trigger_events
     WHERE zone_id = $1
       AND processed = false
     ORDER BY created_at DESC`,
    [id],
  );

  const zone = {
    ...zoneRow,
    risk_level: computeRiskLevel(zoneRow.current_risk_multiplier),
  };

  return res.json({
    success: true,
    data: {
      zone,
      active_triggers: triggersResult.rows,
    },
  });
}

async function getRiskHistory(req, res) {
  const { id } = req.params;
  const weeksRaw = req.query.weeks;

  // Ensure zone exists
  const zoneCheck = await query('SELECT id FROM zones WHERE id = $1', [id]);
  if (!zoneCheck.rows.length) {
    throw ApiError.notFound('Zone not found');
  }

  let weeks = weeksRaw ? parseInt(weeksRaw, 10) : 8;
  if (Number.isNaN(weeks) || weeks <= 0) {
    weeks = 8;
  }
  weeks = Math.min(weeks, 26);

  const { rows } = await query(
    `SELECT *
     FROM zone_risk_history
     WHERE zone_id = $1
     ORDER BY week_start DESC
     LIMIT $2`,
    [id, weeks],
  );

  return res.json({
    success: true,
    data: {
      zone_id: id,
      history: rows,
      weeks_returned: rows.length,
    },
  });
}

module.exports = {
  getAllZones,
  getZoneById,
  getRiskHistory,
};
