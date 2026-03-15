const express = require('express');
const { query, param, body } = require('express-validator');
const asyncHandler = require('../utils/asyncHandler');
const validate = require('../middleware/validate');
const adminAuth = require('../middleware/adminAuth');
const adminController = require('../controllers/admin.controller');

const router = express.Router();

/**
 * Admin routes — insurer dashboard and analytics
 * All routes require adminAuth middleware
 */

// GET /api/admin/dashboard
router.get(
  '/dashboard',
  adminAuth,
  asyncHandler(adminController.getDashboard),
);

// GET /api/admin/zones/risk-map
router.get(
  '/zones/risk-map',
  adminAuth,
  asyncHandler(adminController.getZoneRiskMap),
);

// GET /api/admin/claims
router.get(
  '/claims',
  adminAuth,
  validate([
    query('status')
      .optional()
      .isIn([
        'pending_fraud_check',
        'approved',
        'paid',
        'flagged',
        'rejected',
      ])
      .withMessage(
        'Invalid status. Must be pending_fraud_check, approved, paid, flagged, or rejected',
      ),
    query('zone_id').optional().isUUID().withMessage('Invalid zone ID'),
    query('page')
      .optional()
      .isInt({ min: 1 })
      .withMessage('Page must be >= 1'),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Limit must be between 1 and 100'),
  ]),
  asyncHandler(adminController.getAdminClaims),
);

// PATCH /api/admin/claims/:id/review
router.patch(
  '/claims/:id/review',
  adminAuth,
  validate([
    param('id').isUUID().withMessage('Invalid claim ID'),
    body('action')
      .isIn(['approve', 'reject'])
      .withMessage('Action must be approve or reject'),
    body('notes')
      .optional()
      .isLength({ max: 500 })
      .withMessage('Notes must be 500 characters or less'),
  ]),
  asyncHandler(adminController.reviewClaim),
);

// GET /api/admin/analytics/loss-ratio
router.get(
  '/analytics/loss-ratio',
  adminAuth,
  validate([
    query('weeks')
      .optional()
      .isInt({ min: 1, max: 26 })
      .withMessage('Weeks must be between 1 and 26'),
  ]),
  asyncHandler(adminController.getLossRatioAnalytics),
);

// GET /api/admin/analytics/trigger-frequency
router.get(
  '/analytics/trigger-frequency',
  adminAuth,
  validate([
    query('zone_id').optional().isUUID().withMessage('Invalid zone ID'),
    query('weeks')
      .optional()
      .isInt({ min: 1, max: 26 })
      .withMessage('Weeks must be between 1 and 26'),
  ]),
  asyncHandler(adminController.getTriggerFrequency),
);

// GET /api/admin/riders
router.get(
  '/riders',
  adminAuth,
  validate([
    query('zone_id').optional().isUUID().withMessage('Invalid zone ID'),
    query('kyc_verified')
      .optional()
      .isBoolean()
      .withMessage('KYC verified must be true or false'),
    query('page')
      .optional()
      .isInt({ min: 1 })
      .withMessage('Page must be >= 1'),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Limit must be between 1 and 100'),
  ]),
  asyncHandler(adminController.getAdminRiders),
);

// GET /api/admin/fraud-queue
router.get(
  '/fraud-queue',
  adminAuth,
  asyncHandler(adminController.getFraudQueue),
);

module.exports = router;
