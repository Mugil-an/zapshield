const cron = require('node-cron');

const { query } = require('../config/db');
const { logger, logTrigger } = require('../utils/logger');
const weatherService = require('./weather.service');
const darkstoreService = require('./darkstore.service');
const curfewService = require('./curfew.service');
const fraudService = require('./fraud.service');
const premiumService = require('./premium.service');
const notificationService = require('./notification.service');
const {
  TIER_HOURLY_RATE,
  TRIGGER_MULTIPLIER,
} = require('../config/constants');

let cronTask;

async function processRiderClaim(riderRow, triggerEvent, storeStatus, triggerData) {
  const policyId = riderRow.policy_id;

  const policyResult = await query(
    'SELECT * FROM policies WHERE id = $1',
    [policyId],
  );

  if (!policyResult.rows.length) {
    logger.warn('[ENGINE] Policy not found for rider during claim processing', {
      policy_id: policyId,
      rider_id: riderRow.id,
    });
    return null;
  }

  const policy = policyResult.rows[0];

  const weeklyCapRemaining =
    Number(policy.max_weekly_payout) - Number(policy.total_claimed_this_week);

  if (weeklyCapRemaining <= 0) {
    logger.info(
      '[ENGINE] Weekly cap exhausted, skipping claim generation',
      { rider_id: riderRow.id, policy_id: policy.id },
    );
    return null;
  }

  const durationHours = triggerEvent.duration_hours || 1.0;

  const calculatedPayout = premiumService.calculatePayout(
    policy.tier,
    triggerEvent.trigger_type,
    durationHours,
    weeklyCapRemaining,
  );

  if (calculatedPayout <= 0) {
    return null;
  }

  const fraudResult = await fraudService.checkClaim(
    riderRow,
    policy,
    triggerEvent,
    calculatedPayout,
  );

  const hourlyRate = TIER_HOURLY_RATE[policy.tier];
  const triggerMultiplier =
    TRIGGER_MULTIPLIER[triggerEvent.trigger_type] || 1.0;

  const approvedPayout =
    fraudResult.claim_status === 'approved' ? calculatedPayout : 0;

  const fraudFlagsJson = JSON.stringify(fraudResult.fraud_flags || []);

  const claimInsert = await query(
    `INSERT INTO claims (
       policy_id,
       trigger_event_id,
       rider_id,
       hourly_rate,
       trigger_multiplier,
       duration_hours,
       calculated_payout,
       approved_payout,
       fraud_score,
       fraud_flags,
       status,
       auto_created_at
     )
     VALUES (
       $1, $2, $3,
       $4, $5, $6,
       $7, $8,
       $9, $10,
       $11,
       NOW()
     )
     RETURNING *`,
    [
      policy.id,
      triggerEvent.id,
      riderRow.id,
      hourlyRate,
      triggerMultiplier,
      durationHours,
      calculatedPayout,
      approvedPayout,
      fraudResult.fraud_score,
      fraudFlagsJson,
      fraudResult.claim_status,
    ],
  );

  const claim = claimInsert.rows[0];

  if (fraudResult.claim_status === 'approved') {
    // Lazy import to avoid potential circular dependency
    // eslint-disable-next-line global-require
    const payoutService = require('./payout.service');

    try {
      await payoutService.initiatePayout(claim, riderRow);
    } catch (err) {
      logger.error('[ENGINE] Payout initiation failed', {
        claim_id: claim.id,
        error: err.message,
      });
    }

    await query(
      `UPDATE policies
       SET total_claimed_this_week = total_claimed_this_week + $1
       WHERE id = $2`,
      [approvedPayout, policy.id],
    );

    notificationService.sendPayoutNotification(
      riderRow.id,
      calculatedPayout,
      triggerEvent.trigger_type,
    );
  } else if (fraudResult.claim_status === 'flagged') {
    logger.warn('[ENGINE] Claim flagged for fraud review', {
      claim_id: claim.id,
      rider_id: riderRow.id,
      fraud_score: fraudResult.fraud_score,
    });

    notificationService.sendTriggerAlertNotification(
      riderRow.id,
      triggerEvent.trigger_type,
      policy.zone_id,
    );
  }

  return claim;
}

async function processTrigger(zone, triggerData, storeStatus) {
  const dedupeResult = await query(
    `SELECT id
     FROM trigger_events
     WHERE zone_id = $1
       AND trigger_type = $2
       AND processed = false
       AND created_at > NOW() - INTERVAL '2 hours'
     LIMIT 1`,
    [zone.id, triggerData.trigger_type],
  );

  if (dedupeResult.rows.length) {
    logger.info('[ENGINE] Duplicate trigger suppressed', {
      zone_id: zone.id,
      trigger_type: triggerData.trigger_type,
    });
    return;
  }

  const triggerInsert = await query(
    `INSERT INTO trigger_events (
       zone_id,
       trigger_type,
       threshold_value,
       actual_value,
       dispatch_volume_pct,
       api_source,
       raw_api_response,
       duration_hours,
       event_start,
       processed
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), false)
     RETURNING *`,
    [
      zone.id,
      triggerData.trigger_type,
      triggerData.threshold_value,
      triggerData.actual_value,
      triggerData.dispatch_volume_pct || null,
      triggerData.api_source,
      triggerData.raw_response || null,
      triggerData.duration_hours || null,
    ],
  );

  const triggerEvent = triggerInsert.rows[0];

  const ridersResult = await query(
    `SELECT riders.*,
            policies.id AS policy_id,
            policies.tier,
            policies.max_weekly_payout,
            policies.total_claimed_this_week,
            policies.final_weekly_premium
     FROM riders
     JOIN policies ON policies.rider_id = riders.id
     WHERE policies.zone_id = $1
       AND policies.status = 'active'
       AND policies.coverage_end > NOW()
       AND policies.payment_verified = true
       AND riders.is_active = true`,
    [zone.id],
  );

  let claimsCount = 0;

  // Sequential per rider to keep DB load modest
  // (could be parallelised later with care)
  // eslint-disable-next-line no-restricted-syntax
  for (const riderRow of ridersResult.rows) {
    // eslint-disable-next-line no-await-in-loop
    const claim = await processRiderClaim(riderRow, triggerEvent, storeStatus, triggerData);
    if (claim) {
      claimsCount += 1;
    }
  }

  await query(
    `UPDATE trigger_events
     SET processed = true,
         processed_at = NOW(),
         claims_generated = $1
     WHERE id = $2`,
    [claimsCount, triggerEvent.id],
  );

  logTrigger(zone.id, triggerData.trigger_type, claimsCount);
}

async function processZone(zone) {
  const weatherTriggers = await weatherService.evaluateAllWeatherTriggers(
    zone.lat,
    zone.lng,
  );

  const storeStatus = darkstoreService.getStoreStatus(zone.id);
  const curfewStatus = curfewService.getCurfewStatus(zone.id);

  const detectedTriggers = [...weatherTriggers];

  if (!storeStatus.store_open) {
    detectedTriggers.push({
      triggered: true,
      trigger_type: 'store_closure',
      actual_value: 0,
      threshold_value: 1,
      api_source: 'mock-zepto-api',
      dispatch_volume_pct: storeStatus.dispatch_volume_pct,
    });
  }

  if (curfewStatus.curfew_active) {
    detectedTriggers.push({
      triggered: true,
      trigger_type: 'curfew',
      actual_value: 1,
      threshold_value: 1,
      api_source: 'mock-govt-alert-api',
      dispatch_volume_pct: null,
    });
  }

  // eslint-disable-next-line no-restricted-syntax
  for (const triggerData of detectedTriggers) {
    if (triggerData.triggered) {
      // eslint-disable-next-line no-await-in-loop
      await processTrigger(zone, triggerData, storeStatus);
    }
  }
}

async function runTriggerCycle() {
  logger.info('[ENGINE] Starting trigger cycle...');

  const zonesResult = await query(
    'SELECT * FROM zones WHERE is_active = true',
  );

  // eslint-disable-next-line no-restricted-syntax
  for (const zone of zonesResult.rows) {
    // eslint-disable-next-line no-await-in-loop
    await processZone(zone);
  }

  logger.info('[ENGINE] Trigger cycle completed.');
}

function startTriggerEngine() {
  const interval =
    Number(process.env.TRIGGER_POLL_INTERVAL_MINUTES) || 15;

  const cronExpression = `*/${interval} * * * *`;

  if (cronTask) {
    return;
  }

  cronTask = cron.schedule(cronExpression, async () => {
    try {
      await runTriggerCycle();
    } catch (err) {
      logger.error('[ENGINE] Trigger cycle failed', {
        error: err.message,
      });
    }
  });

  logger.info('[ENGINE] Trigger engine scheduled', {
    interval_minutes: interval,
  });
}

/**
 * Direct trigger processor for manual simulations
 * Allows simulate endpoint to call processTrigger directly
 */
async function processTriggerDirect(zone, triggerData, storeStatus) {
  return await processTrigger(zone, triggerData, storeStatus);
}

module.exports = {
  startTriggerEngine,
  runTriggerCycle,
  processTriggerDirect,
};
