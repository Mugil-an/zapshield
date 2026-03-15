const { processTriggerDirect } = require('./src/services/trigger.engine');
const { query } = require('./src/config/db');

async function testSim() {
  try {
    const zoneId = '8996d9fa-728b-46e5-b57a-5260a46688e2';
    const zoneResult = await query('SELECT * FROM zones WHERE id = $1', [zoneId]);
    const zone = zoneResult.rows[0];

    const triggerData = {
      triggered: true,
      trigger_type: 'rain_burst',
      actual_value: 7.5,
      threshold_value: 2.5,
      duration_hours: 1.5,
      api_source: 'manual-simulation',
      dispatch_volume_pct: 15,
      raw_response: { note: 'test' }
    };

    const storeStatus = {
      store_open: false,
      dispatch_volume_pct: 15,
      store_name: zone.dark_store_name,
      source: 'manual-simulation'
    };

    console.log('Running processTriggerDirect...');
    await processTriggerDirect(zone, triggerData, storeStatus);
    console.log('Done!');
    
    const count = await query('SELECT COUNT(*) FROM claims');
    console.log('Total claims in db:', count.rows[0].count);
    
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}
testSim();
