const { query } = require('./src/config/db');

async function fixDb() {
  try {
    console.log('Updating stuck triggers...');
    const result = await query('UPDATE trigger_events SET processed = true WHERE processed = false');
    console.log(`Updated ${result.rowCount} rows`);
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

fixDb();
