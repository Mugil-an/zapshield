const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { query } = require('../config/db');
const ApiError = require('../utils/apiError');
const { logger } = require('../utils/logger');

const DEFAULT_EXPIRY_SECONDS = 300;
const SALT_ROUNDS = 10;

async function generateOtp(mobile) {
  const rawOtp = crypto.randomInt(100000, 1000000).toString();
  const otpHash = await bcrypt.hash(rawOtp, SALT_ROUNDS);

  const expiresIn =
    Number(process.env.OTP_EXPIRY_SECONDS) || DEFAULT_EXPIRY_SECONDS;

  // Invalidate any previous unused OTPs for this mobile
  await query('DELETE FROM otps WHERE mobile = $1 AND used = false', [mobile]);

  await query(
    `INSERT INTO otps (mobile, otp_hash, expires_at)
     VALUES ($1, $2, NOW() + ($3 || ' seconds')::INTERVAL)`,
    [mobile, otpHash, expiresIn],
  );

  if (process.env.NODE_ENV === 'development') {
    logger.warn(`[OTP DEV] mobile=${mobile} otp=${rawOtp}`);
  }

  return { otp: rawOtp, expiresIn };
}

async function verifyOtp(mobile, submittedOtp) {
  const devMockOtp = process.env.DEV_MOCK_OTP;

  // DEV ONLY — remove before production
  if (
    process.env.NODE_ENV === 'development' &&
    devMockOtp &&
    submittedOtp === devMockOtp
  ) {
    await query(
      'UPDATE otps SET used = true WHERE mobile = $1 AND used = false',
      [mobile],
    );
    return true;
  }

  const { rows } = await query(
    `SELECT *
     FROM otps
     WHERE mobile = $1
       AND used = false
       AND expires_at > NOW()
     ORDER BY created_at DESC
     LIMIT 1`,
    [mobile],
  );

  if (!rows.length) {
    throw ApiError.badRequest('OTP expired or not found');
  }

  const record = rows[0];
  const isMatch = await bcrypt.compare(submittedOtp, record.otp_hash);
  if (!isMatch) {
    throw ApiError.badRequest('Invalid OTP');
  }

  await query('UPDATE otps SET used = true WHERE id = $1', [record.id]);

  return true;
}

module.exports = {
  generateOtp,
  verifyOtp,
};
