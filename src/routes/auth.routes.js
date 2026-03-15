const express = require('express');
const { body } = require('express-validator');
const asyncHandler = require('../utils/asyncHandler');
const validate = require('../middleware/validate');
const rateLimit = require('express-rate-limit');
const authController = require('../controllers/auth.controller');

const router = express.Router();

const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: {
    success: false,
    error: {
      code: 429,
      message: 'Too many OTP requests',
    },
  },
});

router.post(
  '/send-otp',
  otpLimiter,
  validate([
    body('mobile')
      .isMobilePhone('en-IN')
      .withMessage('Invalid Indian mobile number'),
  ]),
  asyncHandler(authController.sendOtp),
);

router.post(
  '/verify-otp',
  validate([
    body('mobile')
      .isMobilePhone('en-IN')
      .withMessage('Invalid Indian mobile number'),
    body('otp')
      .isLength({ min: 6, max: 6 })
      .isNumeric()
      .withMessage('OTP must be exactly 6 digits'),
  ]),
  asyncHandler(authController.verifyOtp),
);

router.post(
  '/admin/login',
  validate([
    body('email').isEmail().normalizeEmail(),
    body('password')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters'),
  ]),
  asyncHandler(authController.adminLogin),
);

module.exports = router;
