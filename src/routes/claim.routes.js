const express = require('express');
const { param } = require('express-validator');
const asyncHandler = require('../utils/asyncHandler');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const claimController = require('../controllers/claim.controller');

const router = express.Router();

/**
 * Claim routes — READ ONLY
 * IMPORTANT: No POST endpoint for riders
 * Claims are created ONLY by the trigger engine service
 */

// GET /api/claims — List all claims for rider (paginated)
router.get('/', auth, asyncHandler(claimController.getClaims));

// GET /api/claims/:claimId — Get specific claim (with UUID validation)
router.get(
  '/:claimId',
  validate([
    param('claimId').isUUID().withMessage('Invalid claim ID'),
  ]),
  auth,
  asyncHandler(claimController.getClaimById),
);

module.exports = router;
