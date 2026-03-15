const axios = require('axios');
const ApiError = require('../utils/apiError');
const { logger } = require('../utils/logger');
const { TRIGGER_THRESHOLDS } = require('../config/constants');

const OPEN_METEO_BASE_URL =
  process.env.OPEN_METEO_BASE_URL || 'https://api.open-meteo.com/v1';

async function fetchCurrentWeather(lat, lng) {
  try {
    const response = await axios.get(`${OPEN_METEO_BASE_URL}/forecast`, {
      params: {
        latitude: lat,
        longitude: lng,
        current: 'precipitation,temperature_2m,rain',
        hourly: 'precipitation,temperature_2m,us_aqi',
        forecast_days: 1,
        timezone: 'Asia/Kolkata',
      },
      timeout: 5000,
    });

    return response.data;
  } catch (err) {
    logger.error('[WEATHER] Error calling Open-Meteo forecast API', {
      error: err.message,
    });
    throw ApiError.internal('Weather API unavailable');
  }
}

function getCurrentIstHour() {
  const now = new Date();
  const istString = now.toLocaleString('en-US', {
    timeZone: 'Asia/Kolkata',
    hour12: false,
    hour: '2-digit',
  });
  return parseInt(istString, 10);
}

async function getCurrentConditions(lat, lng) {
  const data = await fetchCurrentWeather(lat, lng);

  const precipitation =
    data?.current?.precipitation != null ? data.current.precipitation : 0;
  const temperature =
    data?.current?.temperature_2m != null ? data.current.temperature_2m : 0;
  const rain = data?.current?.rain != null ? data.current.rain : 0;

  const currentHourIst = getCurrentIstHour();

  return {
    precipitation_mm: Number(precipitation),
    temperature_celsius: Number(temperature),
    rain_mm: Number(rain),
    current_hour_ist: currentHourIst,
    raw_response: data,
  };
}

function evaluateRainTrigger(conditions) {
  const threshold = TRIGGER_THRESHOLDS.RAIN_MM;
  const triggered = conditions.precipitation_mm >= threshold;

  return {
    triggered,
    trigger_type: 'rain_burst',
    actual_value: conditions.precipitation_mm,
    threshold_value: threshold,
    api_source: 'open-meteo',
  };
}

function evaluateHeatTrigger(conditions) {
  const threshold = TRIGGER_THRESHOLDS.HEAT_CELSIUS;
  const withinWindow =
    conditions.current_hour_ist >= 12 && conditions.current_hour_ist <= 16;
  const triggered = withinWindow && conditions.temperature_celsius >= threshold;

  return {
    triggered,
    trigger_type: 'extreme_heat',
    actual_value: conditions.temperature_celsius,
    threshold_value: threshold,
    api_source: 'open-meteo',
  };
}

async function evaluateAqiTrigger(lat, lng) {
  const AQI_BASE_URL = 'https://air-quality-api.open-meteo.com/v1';
  const url = `${AQI_BASE_URL}/air-quality`;

  try {
    const response = await axios.get(url, {
      params: {
        latitude: lat,
        longitude: lng,
        current: 'us_aqi',
        timezone: 'Asia/Kolkata',
      },
      timeout: 5000,
    });

    const data = response.data;
    const aqi =
      data?.current?.us_aqi != null ? Number(data.current.us_aqi) : 0;

    const threshold = TRIGGER_THRESHOLDS.AQI;
    const triggered = aqi >= threshold;

    return {
      triggered,
      trigger_type: 'severe_aqi',
      actual_value: aqi,
      threshold_value: threshold,
      api_source: 'open-meteo-airquality',
    };
  } catch (err) {
    logger.error('[WEATHER] Error calling Open-Meteo air-quality API', {
      error: err.message,
    });
    throw ApiError.internal('Weather API unavailable');
  }
}

async function evaluateAllWeatherTriggers(lat, lng) {
  try {
    const conditions = await getCurrentConditions(lat, lng);
    const aqiEval = await evaluateAqiTrigger(lat, lng);

    const rainEval = evaluateRainTrigger(conditions);
    const heatEval = evaluateHeatTrigger(conditions);

    const all = [rainEval, heatEval, aqiEval];

    return all.filter((t) => t.triggered);
  } catch (err) {
    logger.warn('[WEATHER] Failed to evaluate weather triggers', {
      error: err.message,
    });
    return [];
  }
}

module.exports = {
  fetchCurrentWeather,
  getCurrentConditions,
  evaluateRainTrigger,
  evaluateHeatTrigger,
  evaluateAqiTrigger,
  evaluateAllWeatherTriggers,
};
