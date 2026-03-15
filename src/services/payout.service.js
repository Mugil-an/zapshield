const { query } = require('../config/db');
const razorpay = require('../config/razorpay');
const { logger, logPayout } = require('../utils/logger');
const notificationService = require('./notification.service');

async function initiatePayout(claim, rider) {
  if (claim.status !== 'approved') {
    logger.warn('[PAYOUT] Attempted payout on non-approved claim', {
      claim_id: claim.id,
      status: claim.status,
    });
    return { success: false, reason: 'claim_not_approved' };
  }

  if (!claim.approved_payout || Number(claim.approved_payout) <= 0) {
    return { success: false, reason: 'zero_payout_amount' };
  }

  try {
    await query(
      `UPDATE claims
       SET status = 'paid',
           payout_initiated_at = NOW()
       WHERE id = $1`,
      [claim.id],
    );

    const mockPayoutId = `pout_mock_${Date.now()}_${String(
      claim.id,
    ).substring(0, 8)}`;

    logger.info('[PAYOUT] Mock payout executed (test mode)', {
      claim_id: claim.id,
      rider_id: rider.id,
      payout_id: mockPayoutId,
      amount: claim.approved_payout,
    });

    try {
      await query(
        `UPDATE claims
         SET razorpay_payout_id = $1,
             payout_completed_at = NOW()
         WHERE id = $2`,
        [mockPayoutId, claim.id],
      );
    } catch (updateErr) {
      logger.error('[PAYOUT] Failed to update claim with payout details', {
        claim_id: claim.id,
        error: updateErr.message,
      });
      await query(
        `UPDATE claims
         SET status = 'approved',
             payout_initiated_at = NULL
         WHERE id = $1`,
        [claim.id],
      );
      return { success: false, reason: 'payout_execution_failed' };
    }

    logPayout(rider.id, claim.id, claim.approved_payout);

    notificationService.sendPayoutNotification(
      rider.id,
      claim.approved_payout,
      claim.trigger_type || 'parametric_trigger',
    );

    return {
      success: true,
      payout_id: mockPayoutId,
      amount: claim.approved_payout,
      rider_id: rider.id,
      claim_id: claim.id,
    };
  } catch (err) {
    logger.error('[PAYOUT] Failed to process payout', {
      claim_id: claim.id,
      error: err.message,
    });

    await query(
      `UPDATE claims
       SET status = 'approved',
           payout_initiated_at = NULL
       WHERE id = $1`,
      [claim.id],
    );

    return { success: false, reason: 'payout_execution_failed' };
  }
}

module.exports = {
  initiatePayout,
};
