const http = require('http');
const dotenv = require('dotenv');

// Load environment variables early
dotenv.config();

// Environment Validation
const requiredEnvVars = [
  'JWT_SECRET',
  'ADMIN_JWT_SECRET',
  'DB_HOST',
  'DB_NAME',
  'DB_USER',
  'DB_PASSWORD',
];

const missing = requiredEnvVars.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`Missing required env vars: ${missing.join(', ')}`);
  process.exit(1);
}

const app = require('./app');
const { pool } = require('./config/db');
const { logger } = require('./utils/logger');
const { startTriggerEngine } = require('./services/trigger.engine');

const PORT = process.env.PORT || 3000;

const server = http.createServer(app);

server.listen(PORT, () => {
  logger.info(`ZapShield backend listening on port ${PORT}`);
  startTriggerEngine();
  logger.info('[ENGINE] Trigger engine started');
});

// Graceful Shutdown
const shutdown = async (signal) => {
  logger.info(`[SERVER] ${signal} received, shutting down`);
  server.close(() => {
    logger.info('[SERVER] HTTP server closed');
    pool.end(() => {
      logger.info('[SERVER] Database pool closed');
      process.exit(0);
    });
  });

  // Force shutdown after 10s
  setTimeout(() => {
    logger.error('[SERVER] Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = server;
