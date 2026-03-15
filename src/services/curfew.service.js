const darkstoreService = require('./darkstore.service');

function getCurfewStatus(zoneId) {
  const now = new Date();
  const currentMinute = now.getMinutes();

  const curfew_active = currentMinute >= 55;

  const base = {
    zone_id: zoneId,
    curfew_active,
    order_reference: null,
    authority: null,
    description: null,
    issued_at: null,
    source: 'mock-govt-alert-api',
  };

  if (!curfew_active) {
    return base;
  }

  return {
    ...base,
    order_reference: 'SEC144-2026-MOCK-001',
    authority: 'Bengaluru Police Commissioner',
    description: 'Section 144 imposed — mock alert for testing',
    issued_at: now.toISOString(),
  };
}

function getZoneRestrictions(zoneId) {
  const store_status = darkstoreService.getStoreStatus(zoneId);
  const curfew_status = getCurfewStatus(zoneId);

  const any_restriction_active =
    !store_status.store_open || curfew_status.curfew_active;

  return {
    zone_id: zoneId,
    store_status,
    curfew_status,
    any_restriction_active,
    checked_at: new Date().toISOString(),
  };
}

module.exports = {
  getCurfewStatus,
  getZoneRestrictions,
};
