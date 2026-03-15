const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const otpService = require('../services/otp.service');
const { query } = require('../config/db');
const ApiError = require('../utils/apiError');

async function sendOtp(req, res) {
  const { mobile } = req.body;

  const result = await otpService.generateOtp(mobile);

  return res.json({
    success: true,
    data: {
      message: 'OTP sent successfully',
      expiresIn: result.expiresIn,
      ...(process.env.NODE_ENV === 'development' && { dev_otp: result.otp }),
    },
  });
}

async function verifyOtp(req, res) {
  const { mobile, otp } = req.body;

  await otpService.verifyOtp(mobile, otp);

  let isNewRider = false;
  let rider;

  const existing = await query('SELECT * FROM riders WHERE mobile = $1', [
    mobile,
  ]);

  if (existing.rows.length) {
    rider = existing.rows[0];
  } else {
    const inserted = await query(
      'INSERT INTO riders (mobile) VALUES ($1) RETURNING *',
      [mobile],
    );
    rider = inserted.rows[0];
    isNewRider = true;
  }

  if (!process.env.JWT_SECRET) {
    throw ApiError.internal('JWT secret not configured');
  }

  const token = jwt.sign(
    {
      riderId: rider.id,
      mobile: rider.mobile,
      role: 'rider',
    },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRES_IN,
    },
  );

  return res.json({
    success: true,
    data: {
      token,
      rider: {
        id: rider.id,
        mobile: rider.mobile,
        name: rider.name,
        kyc_verified: rider.kyc_verified,
        zone_id: rider.zone_id,
        isNewRider,
      },
    },
  });
}

async function adminLogin(req, res) {
  const { email, password } = req.body;

  const result = await query(
    'SELECT * FROM admin_users WHERE email = $1 AND is_active = true',
    [email],
  );

  if (!result.rows.length) {
    throw ApiError.unauthorized('Invalid credentials');
  }

  const admin = result.rows[0];
  const passwordMatch = await bcrypt.compare(password, admin.password_hash);

  if (!passwordMatch) {
    throw ApiError.unauthorized('Invalid credentials');
  }

  if (!process.env.ADMIN_JWT_SECRET) {
    throw ApiError.internal('Admin JWT secret not configured');
  }

  const token = jwt.sign(
    {
      adminId: admin.id,
      email: admin.email,
      role: admin.role,
    },
    process.env.ADMIN_JWT_SECRET,
    {
      expiresIn: process.env.ADMIN_JWT_EXPIRES_IN,
    },
  );

  return res.json({
    success: true,
    data: {
      token,
      admin: {
        id: admin.id,
        email: admin.email,
        role: admin.role,
      },
    },
  });
}

module.exports = {
  sendOtp,
  verifyOtp,
  adminLogin,
};
