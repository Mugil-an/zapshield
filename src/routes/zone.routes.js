const router = require('express').Router();
const { query, param } = require('express-validator');
const asyncHandler = require('../utils/asyncHandler');
const validate = require('../middleware/validate');
const zoneController = require('../controllers/zone.controller');

router.get(
  '/',
  validate([
    query('lat').optional().isFloat({ min: -90, max: 90 }),
    query('lng').optional().isFloat({ min: -180, max: 180 }),
    query('radius').optional().isInt({ min: 100, max: 50000 }),
    query('city').optional().isLength({ max: 50 }),
  ]),
  asyncHandler(zoneController.getAllZones),
);

router.get(
  '/:id',
  validate([
    param('id').isUUID().withMessage('Invalid zone ID'),
  ]),
  asyncHandler(zoneController.getZoneById),
);

router.get(
  '/:id/risk-history',
  validate([
    param('id').isUUID(),
    query('weeks').optional().isInt({ min: 1, max: 26 }),
  ]),
  asyncHandler(zoneController.getRiskHistory),
);

module.exports = router;
