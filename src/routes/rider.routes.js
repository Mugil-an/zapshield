const router = require('express').Router();
const { body } = require('express-validator');
const asyncHandler = require('../utils/asyncHandler');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const riderController = require('../controllers/rider.controller');

router.get('/me', auth, asyncHandler(riderController.getMe));

router.put(
  '/me',
  auth,
  validate([
    body('name').optional().isLength({ min: 2, max: 100 }),
    body('partner_id').optional().isLength({ min: 3, max: 50 }),
    body('aadhaar_last4')
      .optional()
      .isLength({ min: 4, max: 4 })
      .isNumeric()
      .withMessage('Aadhaar last 4 must be numeric'),
    body('declared_daily_earnings')
      .optional()
      .isFloat({ min: 100, max: 5000 })
      .withMessage('Earnings must be between 100 and 5000'),
    body('zone_id').optional().isUUID(),
  ]),
  asyncHandler(riderController.updateMe),
);

router.get(
  '/me/dashboard',
  auth,
  asyncHandler(riderController.getDashboard),
);

module.exports = router;
