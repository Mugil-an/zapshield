const {
  TIER_BASE,
  TIER_MAX_PAYOUT,
  TIER_HOURLY_RATE,
  TRIGGER_MULTIPLIER,
  SEASON_FACTORS,
  MONSOON_MONTHS,
  SUMMER_MONTHS,
  POLICY_DURATION_DAYS,
} = require('../config/constants');

function getSeasonFactor(date) {
  const month = date.getMonth() + 1;
  if (MONSOON_MONTHS.includes(month)) 
    return parseFloat(SEASON_FACTORS.MONSOON.toFixed(2));
  if (SUMMER_MONTHS.includes(month))  
    return parseFloat(SEASON_FACTORS.SUMMER.toFixed(2));
  return parseFloat(SEASON_FACTORS.WINTER.toFixed(2));
}

function getTenureDiscountFactor(months) {
  const discount = 1.0 - months * 0.01;
  return Math.max(0.85, discount);
}

function getRiderTenureMonths(createdAt) {
  const createdDate = createdAt instanceof Date ? createdAt : new Date(createdAt);
  const now = new Date();
  const diffMs = now.getTime() - createdDate.getTime();
  const months = Math.floor(diffMs / (1000 * 60 * 60 * 24 * 30));
  return months < 0 ? 0 : months;
}

function calculateWeeklyPremium(tier, zoneRiskMultiplier, tenureMonths, referenceDate = new Date()) {
  const base = TIER_BASE[tier];
  const seasonFactor = getSeasonFactor(referenceDate);
  const tenureFactor = getTenureDiscountFactor(tenureMonths);
  const raw = base * zoneRiskMultiplier * seasonFactor * tenureFactor;
  return Math.round(raw);
}

function getSeasonName(date) {
  const month = date.getMonth() + 1;
  if (MONSOON_MONTHS.includes(month)) return 'Monsoon';
  if (SUMMER_MONTHS.includes(month)) return 'Summer';
  return 'Winter';
}

function buildPremiumExplainer(tier, zoneRiskMultiplier, tenureMonths, referenceDate = new Date()) {
  const base = TIER_BASE[tier];
  const seasonFactor = getSeasonFactor(referenceDate);
  const tenureFactor = getTenureDiscountFactor(tenureMonths);
  const raw = base * zoneRiskMultiplier * seasonFactor * tenureFactor;

  const baseAmount = base;

  const zoneAdjusted = Math.round(base * zoneRiskMultiplier);
  const zoneDelta = zoneAdjusted - baseAmount;

  const seasonAdjusted = Math.round(base * zoneRiskMultiplier * seasonFactor);
  const seasonDelta = seasonAdjusted - zoneAdjusted;

  const finalRounded = Math.round(raw);
  const loyaltyDelta = seasonAdjusted - finalRounded;

  const seasonName = getSeasonName(referenceDate);

  const lines = [
    {
      label: `Base rate (${tier} tier)`,
      amount: baseAmount,
      sign: '+',
    },
    {
      label: 'Zone risk adjustment',
      amount: zoneDelta,
      sign: zoneRiskMultiplier >= 1 ? '+' : '-',
    },
    {
      label: `Season adjustment (${seasonName})`,
      amount: seasonDelta,
      sign: seasonFactor >= 1 ? '+' : '-',
    },
  ];

  if (tenureMonths > 0) {
    lines.push({
      label: 'Loyalty discount',
      amount: loyaltyDelta,
      sign: '-',
    });
  }

  return {
    lines,
    subtotal: finalRounded,
    final_premium: finalRounded,
    max_weekly_payout: TIER_MAX_PAYOUT[tier],
  };
}

function calculatePayout(tier, triggerType, durationHours, weeklyCapRemaining) {
  const hourlyRate = TIER_HOURLY_RATE[tier];
  const multiplier = TRIGGER_MULTIPLIER[triggerType];
  const raw = hourlyRate * multiplier * durationHours;
  const capped = Math.min(raw, weeklyCapRemaining);
  return Math.round(capped);
}

function getCoverageWindow() {
  const MS_PER_HOUR = 60 * 60 * 1000;
  const IST_OFFSET_MS = 5.5 * MS_PER_HOUR;

  const now = new Date();
  const nowIst = new Date(now.getTime() + IST_OFFSET_MS);

  const year = nowIst.getUTCFullYear();
  const month = nowIst.getUTCMonth();
  const date = nowIst.getUTCDate();
  const dayOfWeek = nowIst.getUTCDay(); // 0=Sun,1=Mon,...

  let mondayDate;
  if (dayOfWeek === 1) {
    mondayDate = date;
  } else {
    const daysUntilMonday = (8 - dayOfWeek) % 7;
    mondayDate = date + daysUntilMonday;
  }

  const sundayDate = mondayDate + (POLICY_DURATION_DAYS - 1);

  const coverageStartUtcMs =
    Date.UTC(year, month, mondayDate, 0, 0, 0) - IST_OFFSET_MS;
  const coverageEndUtcMs =
    Date.UTC(year, month, sundayDate, 23, 59, 59) - IST_OFFSET_MS;

  return {
    coverage_start: new Date(coverageStartUtcMs),
    coverage_end: new Date(coverageEndUtcMs),
  };
}

module.exports = {
  getSeasonFactor,
  getTenureDiscountFactor,
  getRiderTenureMonths,
  calculateWeeklyPremium,
  buildPremiumExplainer,
  calculatePayout,
  getCoverageWindow,
};
