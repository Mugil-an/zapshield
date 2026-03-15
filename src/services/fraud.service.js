const axios = require('axios');

const {
  FRAUD_SCORE_THRESHOLDS,
  TRIGGER_THRESHOLDS,
} = require('../config/constants');
const { query } = require('../config/db');
const { logger, logFraud } = require('../utils/logger');
const ApiError = require('../utils/apiError');
const darkstoreService = require('./darkstore.service');

function checkDispatchVolume(triggerEvent) {
  if (
    triggerEvent.dispatch_volume_pct === null ||
    typeof triggerEvent.dispatch_volume_pct === 'undefined'
  ) {
    return { flag: null, score: 0 };
  }

  if (
    triggerEvent.dispatch_volume_pct >
    TRIGGER_THRESHOLDS.DISPATCH_FRAUD_PCT
  ) {
    return { flag: 'dispatch_volume_high', score: 0.35 };
  }

  return { flag: null, score: 0 };
}

function checkGpsZone(riderId, zoneId) {
  if (process.env.NODE_ENV === 'development') {
    return { flag: null, score: 0 };
  }
  // production hash-based logic kept for reference
  const hash = riderId.split('').reduce(
    (sum, c) => sum + c.charCodeAt(0), 0) % 10;
  if (hash >= 8) {
    return { flag: 'gps_outside_zone', score: 0.40 };
  }
  return { flag: null, score: 0 };
}

async function checkZeroActivity(riderId, zoneId) {
  const activity = darkstoreService.getDeliveryActivity(riderId, zoneId);

  if (activity.deliveries_today === 0) {
    return { flag: 'no_activity_before_trigger', score: 0.25 };
  }

  return { flag: null, score: 0 };
}

async function checkNewPolicy(policyId) {
  const { rows } = await query(
    'SELECT created_at FROM policies WHERE id = $1',
    [policyId],
  );

  if (!rows.length) {
    throw ApiError.notFound('Policy not found for fraud check');
  }

  const createdAt = new Date(rows[0].created_at);
  const now = new Date();
  const policyAgeHours =
    (now.getTime() - createdAt.getTime()) / 3_600_000;

  if (policyAgeHours < 24) {
    return { flag: 'new_policy_day_one', score: 0.2 };
  }

  return { flag: null, score: 0 };
}

async function checkClaimFrequency(riderId) {
  const { rows } = await query(
    `SELECT COUNT(*) AS count
     FROM claims
     WHERE rider_id = $1
       AND auto_created_at > NOW() - INTERVAL '7 days'
       AND status != 'rejected'`,
    [riderId],
  );

  const count = parseInt(rows[0].count, 10) || 0;

  if (count >= 3) {
    return { flag: 'high_claim_frequency', score: 0.15 };
  }

  return { flag: null, score: 0 };
}

async function callMlFraudCheck(
  riderId,
  zoneId,
  triggerType,
  declaredEarnings,
  claimAmount,
) {
  const baseUrl = process.env.ML_SERVICE_URL;

  if (!baseUrl) {
    logger.warn(
      '[FRAUD] ML service URL not configured, using rules only',
    );
    return 0.0;
  }

  try {
    const response = await axios.post(`${baseUrl}/fraud-check`, {
      rider_id: riderId,
      zone_id: zoneId,
      trigger_type: triggerType,
      declared_daily_earnings: declaredEarnings,
      claim_amount: claimAmount,
    });

    const anomaly = Number(response.data?.anomaly_score || 0);
    if (Number.isNaN(anomaly) || anomaly < 0) return 0.0;
    if (anomaly > 1) return 1.0;
    return anomaly;
  } catch (err) {
    logger.warn(
      '[FRAUD] ML service unavailable, using rules only',
      { error: err.message },
    );
    return 0.0;
  }
}

async function checkClaim(rider, policy, triggerEvent, claimAmount) {
  const dispatchResult = checkDispatchVolume(triggerEvent);
  const gpsResult = checkGpsZone(rider.id, policy.zone_id);

  const [zeroActivityResult, newPolicyResult, frequencyResult] =
    await Promise.all([
      checkZeroActivity(rider.id, policy.zone_id),
      checkNewPolicy(policy.id),
      checkClaimFrequency(rider.id),
    ]);

  const ruleResults = [
    dispatchResult,
    gpsResult,
    zeroActivityResult,
    newPolicyResult,
    frequencyResult,
  ];

  const ruleFlags = ruleResults
    .filter((r) => r.flag !== null)
    .map((r) => r.flag);

  let ruleScore = ruleResults.reduce((sum, r) => sum + r.score, 0);
  ruleScore = Math.min(ruleScore, 1.0);

  const mlScore = await callMlFraudCheck(
    rider.id,
    policy.zone_id,
    triggerEvent.trigger_type,
    rider.declared_daily_earnings,
    claimAmount,
  );

  let finalScore = ruleScore * 0.6 + mlScore * 0.4;
  finalScore = Math.min(finalScore, 1.0);
  finalScore = parseFloat(finalScore.toFixed(4));

  logFraud(rider.id, finalScore, ruleFlags);

  let claimStatus;
  if (finalScore < FRAUD_SCORE_THRESHOLDS.AUTO_APPROVE) {
    claimStatus = 'approved';
  } else if (finalScore >= FRAUD_SCORE_THRESHOLDS.AUTO_REJECT) {
    claimStatus = 'rejected';
  } else {
    claimStatus = 'flagged';
  }

  return {
    fraud_score: finalScore,
    fraud_flags: ruleFlags,
    claim_status: claimStatus,
    rule_score: ruleScore,
    ml_score: mlScore,
  };
}

module.exports = {
  checkDispatchVolume,
  checkGpsZone,
  checkZeroActivity,
  checkNewPolicy,
  checkClaimFrequency,
  callMlFraudCheck,
  checkClaim,
};
