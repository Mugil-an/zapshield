const express = require('express');
const { query, param, body } = require('express-validator');
const asyncHandler = require('../utils/asyncHandler');
const validate = require('../middleware/validate');
const adminAuth = require('../middleware/adminAuth');
const triggerController = require('../controllers/trigger.controller');

const router = express.Router();

/**
 * Trigger routes — inspection and simulation
 * All routes require adminAuth middleware
 */

// GET /api/triggers — List triggers with pagination and filters
router.get(
  '/',
  adminAuth,
  validate([
    query('zone_id').optional().isUUID().withMessage('Invalid zone ID'),
    query('type')
      .optional()
      .isIn(['rain_burst', 'extreme_heat', 'severe_aqi', 'store_closure', 'curfew'])
      .withMessage(
        'Type must be rain_burst, extreme_heat, severe_aqi, store_closure, or curfew',
      ),
    query('processed')
      .optional()
      .isBoolean()
      .withMessage('Processed must be true or false'),
    query('page')
      .optional()
      .isInt({ min: 1 })
      .withMessage('Page must be >= 1'),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Limit must be between 1 and 100'),
  ]),
  asyncHandler(triggerController.getTriggers),
);

// GET /api/triggers/:id — Get single trigger with associated claims
router.get(
  '/:id',
  adminAuth,
  validate([param('id').isUUID().withMessage('Invalid trigger ID')]),
  asyncHandler(triggerController.getTriggerById),
);

// POST /api/triggers/simulate — Manual trigger simulation for demo
router.post(
  '/simulate',
  adminAuth,
  validate([
    body('zone_id').isUUID().withMessage('Zone ID must be a valid UUID'),
    body('trigger_type')
      .isIn(['rain_burst', 'extreme_heat', 'severe_aqi', 'store_closure', 'curfew'])
      .withMessage(
        'Trigger type must be rain_burst, extreme_heat, severe_aqi, store_closure, or curfew',
      ),
    body('actual_value')
      .isFloat({ min: 0 })
      .withMessage('Actual value must be a positive number'),
    body('duration_hours')
      .optional()
      .isFloat({ min: 0.5, max: 8.0 })
      .withMessage('Duration hours must be between 0.5 and 8.0'),
    body('dispatch_volume_pct')
      .optional()
      .isFloat({ min: 0, max: 100 })
      .withMessage('Dispatch volume percent must be between 0 and 100'),
  ]),
  asyncHandler(triggerController.simulate),
);

module.exports = router;
