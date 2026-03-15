const router = require('express').Router();
const { body, query, param } = require('express-validator');
const asyncHandler = require('../utils/asyncHandler');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const policyController = require('../controllers/policy.controller');

router.post(
  '/quote',
  auth,
  validate([
    body('zone_id').isUUID(),
    body('tier').isIn(['basic', 'standard', 'premium']),
  ]),
  asyncHandler(policyController.getQuote),
);

router.post(
  '/create-razorpay-order',
  auth,
  validate([
    body('zone_id').isUUID(),
    body('tier').isIn(['basic', 'standard', 'premium']),
  ]),
  asyncHandler(policyController.createRazorpayOrder),
);

router.post(
  '/bind',
  auth,
  validate([
    body('quote_token').notEmpty(),
    body('razorpay_order_id').notEmpty(),
    body('razorpay_payment_id').notEmpty(),
    body('razorpay_signature').notEmpty(),
  ]),
  asyncHandler(policyController.bindPolicy),
);

router.get(
  '/active',
  auth,
  asyncHandler(policyController.getActivePolicy),
);

router.get(
  '/',
  auth,
  validate([
    query('status')
      .optional()
      .isIn(['active', 'expired', 'cancelled']),
    query('page')
      .optional()
      .isInt({ min: 1 }),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 50 }),
  ]),
  asyncHandler(policyController.getPolicies),
);

router.get(
  '/:id',
  auth,
  validate([param('id').isUUID()]),
  asyncHandler(policyController.getPolicyById),
);

module.exports = router;
