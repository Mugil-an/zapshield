const { query } = require('./src/config/db');
const fs = require('fs');

async function check() {
  try {
    const zoneId = '8996d9fa-728b-46e5-b57a-5260a46688e2';
    
    const { rows: rawRiders } = await query(`
      SELECT r.id, r.name, r.is_active as rider_active, p.id as policy_id, p.status, p.coverage_end, p.payment_verified, p.zone_id
      FROM riders r
      LEFT JOIN policies p ON p.rider_id = r.id
      WHERE p.zone_id = $1
    `, [zoneId]);

    const ridersResult = await query(
      `SELECT riders.name
       FROM riders
       JOIN policies ON policies.rider_id = riders.id
       WHERE policies.zone_id = $1
         AND policies.status = 'active'
         AND policies.coverage_end > NOW()
         AND policies.payment_verified = true
         AND riders.is_active = true`,
      [zoneId],
    );
    
    fs.writeFileSync('output.json', JSON.stringify({ rawRiders, eligible: ridersResult.rows }, null, 2));
    process.exit(0);
  } catch(e) {
    console.error(e);
    process.exit(1);
  }
}
check();
