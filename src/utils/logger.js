const fs = require('fs');
const path = require('path');
const { createLogger, transports, format } = require('winston');

const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const consoleFormat = format.printf(({ level, message, timestamp }) => {
  return `[${timestamp}] ${level}: ${message}`;
});

const loggerTransports = [];

if (process.env.NODE_ENV !== 'production') {
  loggerTransports.push(
    new transports.Console({
      format: format.combine(
        format.colorize(),
        format.timestamp(),
        consoleFormat,
      ),
    }),
  );
}

loggerTransports.push(
  new transports.File({
    filename: path.join(logsDir, 'error.log'),
    level: 'error',
    format: format.combine(format.timestamp(), format.json()),
  }),
);

loggerTransports.push(
  new transports.File({
    filename: path.join(logsDir, 'combined.log'),
    level: 'info',
    format: format.combine(format.timestamp(), format.json()),
  }),
);

const logger = createLogger({
  level: 'info',
  transports: loggerTransports,
});

function logTrigger(zoneId, triggerType, claimsGenerated) {
  logger.info(
    `[TRIGGER] zone=${zoneId} type=${triggerType} claims=${claimsGenerated}`,
  );
}

function logPayout(riderId, claimId, amount) {
  logger.info(
    `[PAYOUT] rider=${riderId} claim=${claimId} amount=₹${amount}`,
  );
}

function logFraud(riderId, fraudScore, flags) {
  const flagsJoined = Array.isArray(flags) ? flags.join(',') : String(flags);
  logger.warn(
    `[FRAUD] rider=${riderId} score=${fraudScore} flags=${flagsJoined}`,
  );
}

function logDb(queryText, durationMs) {
  if (durationMs > 1000) {
    logger.debug(`[DB SLOW] ${queryText} took ${durationMs}ms`);
  }
}

module.exports = {
  logger,
  logTrigger,
  logPayout,
  logFraud,
  logDb,
};
