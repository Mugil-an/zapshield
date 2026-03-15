const router = require('express').Router();
const { query } = require('express-validator');
const asyncHandler = require('../utils/asyncHandler');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const payoutController = require('../controllers/payout.controller');

router.get(
  '/',
  auth,
  validate([
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 50 }),
  ]),
  asyncHandler(payoutController.getPayouts),
);

router.get(
  '/summary',
  auth,
  asyncHandler(payoutController.getPayoutSummary),
);

module.exports = router;
