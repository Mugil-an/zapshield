const { TRIGGER_THRESHOLDS } = require('../config/constants');

// Hardcoded mapping from zone_id to mock dark store name
const STORE_NAME_MAP = {
  '8996d9fa-728b-46e5-b57a-5260a46688e2': 'Zepto Koramangala',
  'd60678fe-7bd5-4c34-b792-57156d2b4042': 'Zepto Indiranagar',
  '15ddf839-ed32-4b35-a0ef-7ff8330b8d32': 'Blinkit HSR Layout',
  '176db3bf-1a10-4d0c-90ed-e54b6740f106': 'Blinkit Whitefield',
  'f15e8580-b9fb-4b72-8d17-497d044829ca': 'Zepto JP Nagar',
};

function getStoreStatus(zoneId) {
  const now = new Date();
  const currentMinute = now.getMinutes();

  const inClosureWindow = currentMinute >= 45 && currentMinute <= 50;
  const store_open = !inClosureWindow;

  let closure_reason = null;
  if (!store_open) {
    // Deterministically choose a closure reason within the window
    closure_reason =
      currentMinute % 2 === 0
        ? 'scheduled_maintenance'
        : 'emergency_closure';
  }

  let dispatch_volume_pct;
  if (store_open) {
    const base = 85;
    const variation = (currentMinute % 20) - 10; // -10 .. +10
    const raw = base + variation;
    dispatch_volume_pct = Math.min(100, Math.max(20, raw));
  } else {
    dispatch_volume_pct = 0;
  }

  const store_name = STORE_NAME_MAP[zoneId] || 'Unknown Store';

  return {
    zone_id: zoneId,
    store_open,
    store_name,
    closure_reason,
    dispatch_volume_pct,
    checked_at: now.toISOString(),
    source: 'mock-zepto-api',
  };
}

function getDeliveryActivity(riderId, zoneId) {
  const now = new Date();
  const hour = now.getHours();

  const hash =
    riderId
      .split('')
      .reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % 10;

  const baseDeliveries = 3 + hash; // 3–12
  let deliveries_today;

  if (hour < 8) {
    deliveries_today = 0;
  } else if (hour < 12) {
    deliveries_today = Math.floor(baseDeliveries * 0.3);
  } else if (hour < 17) {
    deliveries_today = Math.floor(baseDeliveries * 0.7);
  } else {
    deliveries_today = baseDeliveries;
  }

  let last_delivery_at = null;
  if (deliveries_today > 0) {
    // Deterministic pseudo-random offset in [5, 30] minutes
    const offsetMinutes = 5 + ((hash + hour) % 26);
    const last = new Date(now.getTime() - offsetMinutes * 60 * 1000);
    last_delivery_at = last.toISOString();
  }

  return {
    rider_id: riderId,
    zone_id: zoneId,
    deliveries_today,
    last_delivery_at,
    source: 'mock-zepto-api',
  };
}

module.exports = {
  getStoreStatus,
  getDeliveryActivity,
};
