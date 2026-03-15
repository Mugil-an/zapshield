// Centralised business constants for ZapShield.
// All actuarial and trigger-related magic numbers must be referenced
// via this module to keep pricing and payout logic explainable.

const TIER_BASE = { basic: 29, standard: 49, premium: 79 };

const TIER_MAX_PAYOUT = { basic: 300, standard: 600, premium: 1200 };

const TIER_HOURLY_RATE = { basic: 50, standard: 80, premium: 120 };

const TRIGGER_MULTIPLIER = {
  rain_burst: 1.0,
  extreme_heat: 0.75,
  severe_aqi: 0.625,
  store_closure: 1.25,
  curfew: 1.25,
};

const TRIGGER_THRESHOLDS = {
  RAIN_MM: 4.0,
  HEAT_CELSIUS: 40.0,
  AQI: 300,
  DISPATCH_FRAUD_PCT: 40.0,
};

const FRAUD_SCORE_THRESHOLDS = {
  AUTO_APPROVE: 0.3,
  AUTO_REJECT: 0.8,
};

const SEASON_FACTORS = {
  MONSOON: 1.25,
  SUMMER: 1.1,
  WINTER: 0.95,
};

const MONSOON_MONTHS = [6, 7, 8, 9];
const SUMMER_MONTHS = [3, 4, 5];

const POLICY_DURATION_DAYS = 7;
const ZONE_RADIUS_METERS = 500;

module.exports = {
  TIER_BASE,
  TIER_MAX_PAYOUT,
  TIER_HOURLY_RATE,
  TRIGGER_MULTIPLIER,
  TRIGGER_THRESHOLDS,
  FRAUD_SCORE_THRESHOLDS,
  SEASON_FACTORS,
  MONSOON_MONTHS,
  SUMMER_MONTHS,
  POLICY_DURATION_DAYS,
  ZONE_RADIUS_METERS,
};

