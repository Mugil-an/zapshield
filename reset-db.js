const fs = require('fs');
const { query } = require('./src/config/db');

async function reset() {
  try {
    const schema = fs.readFileSync('src/db/schema.sql', 'utf8');
    const seed = fs.readFileSync('src/db/seed.sql', 'utf8');
    
    console.log('Dropping schema and recreating...');
    await query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
    
    console.log('Running schema...');
    await query(schema);
    
    console.log('Running seed...');
    await query(seed);
    
    console.log('Database reset successfully!');
    process.exit(0);
  } catch(e) {
    console.error(e);
    process.exit(1);
  }
}
reset();
