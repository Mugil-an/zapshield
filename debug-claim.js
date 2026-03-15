const { query } = require('./src/config/db');
const premiumService = require('./src/services/premium.service');
const fs = require('fs');

async function debug() {
  try {
    const zoneId = '8996d9fa-728b-46e5-b57a-5260a46688e2';
    const triggerType = 'rain_burst';
    const durationHours = 1.5;

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
      [zoneId],
    );

    const riderRow = ridersResult.rows[0];
    const policyResult = await query(
      'SELECT * FROM policies WHERE id = $1',
      [riderRow.policy_id],
    );
    
    const policy = policyResult.rows[0];
    const weeklyCapRemaining = Number(policy.max_weekly_payout) - Number(policy.total_claimed_this_week);

    let calculatedPayout = null;
    if (weeklyCapRemaining > 0) {
      calculatedPayout = premiumService.calculatePayout(
        policy.tier,
        triggerType,
        durationHours,
        weeklyCapRemaining,
      );
    }
    
    const out = {
      weeklyCapRemaining,
      calculatedPayout,
      tier: policy.tier,
      triggerType,
      durationHours,
      policy
    };
    
    fs.writeFileSync('debug.json', JSON.stringify(out, null, 2));
    process.exit(0);
  } catch(e) {
    console.error(e);
    process.exit(1);
  }
}
debug()
