// Push notification delivery stub. No real integration in this phase.

const { logger } = require('../utils/logger');

function sendPayoutNotification(riderId, amount, triggerType) {
  logger.info(
    `[NOTIFY] rider=${riderId} payout=₹${amount} trigger=${triggerType}`,
  );

  return {
    sent: true,
    channel: 'mock',
    rider_id: riderId,
  };
}

function sendPolicyActivationNotification(riderId, policyId, tier) {
  logger.info(
    `[NOTIFY] policy activated rider=${riderId} policy=${policyId} tier=${tier}`,
  );

  return {
    sent: true,
    channel: 'mock',
    rider_id: riderId,
  };
}

function sendTriggerAlertNotification(riderId, triggerType, zoneId) {
  logger.info(
    `[NOTIFY] trigger alert rider=${riderId} type=${triggerType} zone=${zoneId}`,
  );

  return {
    sent: true,
    channel: 'mock',
    rider_id: riderId,
  };
}

module.exports = {
  sendPayoutNotification,
  sendPolicyActivationNotification,
  sendTriggerAlertNotification,
};
