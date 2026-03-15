const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const { Pool } = require('pg');
const { logger } = require('../utils/logger');

const {
  DB_HOST = 'localhost',
  DB_PORT = 5432,
  DB_NAME = 'zapshield',
  DB_USER = 'zapshield_user',
  DB_PASSWORD = 'changeme',
} = process.env;

const pool = new Pool({
  host: DB_HOST,
  port: Number(DB_PORT),
  database: DB_NAME,
  user: DB_USER,
  password: DB_PASSWORD,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  logger.error('[DB] Unexpected error on idle client', { error: err.message });
});

async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;

  if (duration > 1000) {
    logger.warn('[DB] Slow query detected', { text, duration, rowCount: res.rowCount });
  }

  return res;
}

async function getClient() {
  return pool.connect();
}

// Test connection on startup without crashing the process on failure
(async () => {
  try {
    const client = await pool.connect();
    client.release();
    logger.info('[DB] Connected to PostgreSQL');
  } catch (err) {
    logger.error('[DB] Connection test failed', { error: err.message });
  }
})();

module.exports = {
  pool,
  query,
  getClient,
};

