const express = require('express');

const authRoutes = require('./auth.routes');
const riderRoutes = require('./rider.routes');
const zoneRoutes = require('./zone.routes');
const policyRoutes = require('./policy.routes');
const claimRoutes = require('./claim.routes');
const payoutRoutes = require('./payout.routes');
const triggerRoutes = require('./trigger.routes');
const adminRoutes = require('./admin.routes');

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/riders', riderRoutes);
router.use('/zones', zoneRoutes);
router.use('/policies', policyRoutes);
router.use('/claims', claimRoutes);
router.use('/payouts', payoutRoutes);
router.use('/triggers', triggerRoutes);
router.use('/admin', adminRoutes);

router.get('/health', (req, res) => {
  res.json({
    success: true,
    data: {
      service: 'zapshield-backend',
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
    },
  });
});

module.exports = router;
