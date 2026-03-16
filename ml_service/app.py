"""
ZapShield — ML Microservice (Flask)
=====================================
Replaces the inline dummy Flask script in docker-compose.yml.
Place this file at: ml_service/app.py

Endpoints:
  POST /score-zone    — Zone risk multiplier (GBR)
  POST /fraud-check   — Rider anomaly score (Isolation Forest)
  GET  /health        — Health + model load status
  GET  /model-meta    — Feature importances, training metadata (for judge demo)

All models are loaded at startup. Inference is <2ms per request.
"""

import json
import os
import logging
import traceback
from datetime import datetime

import joblib
import numpy as np
from flask import Flask, jsonify, request

# ─────────────────────────────────────────────
# Setup
# ─────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("zapshield-ml")

app = Flask(__name__)

# ─────────────────────────────────────────────
# Model paths (relative to this file's directory)
# ─────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(BASE_DIR, "models")

# ─────────────────────────────────────────────
# Model registry — loaded once at startup
# ─────────────────────────────────────────────
_models = {
    "zone_risk": None,
    "zone_risk_scaler": None,
    "zone_risk_meta": None,
    "fraud": None,
    "fraud_scaler": None,
    "fraud_meta": None,
}
_startup_errors = []


def load_models():
    """Load all models at startup. Fail gracefully per model."""
    model_files = {
        "zone_risk":         "zone_risk_model.joblib",
        "zone_risk_scaler":  "zone_risk_scaler.joblib",
        "fraud":             "fraud_model.joblib",
        "fraud_scaler":      "fraud_scaler.joblib",
    }
    meta_files = {
        "zone_risk_meta": "zone_risk_meta.json",
        "fraud_meta":     "fraud_model_meta.json",
    }

    for key, filename in model_files.items():
        path = os.path.join(MODELS_DIR, filename)
        try:
            _models[key] = joblib.load(path)
            logger.info(f"✓ Loaded {key} from {path}")
        except FileNotFoundError:
            msg = f"Model file not found: {path} — run train_zone_risk.py / train_fraud_model.py first"
            logger.error(msg)
            _startup_errors.append(msg)
        except Exception as e:
            msg = f"Failed to load {key}: {e}"
            logger.error(msg)
            _startup_errors.append(msg)

    for key, filename in meta_files.items():
        path = os.path.join(MODELS_DIR, filename)
        try:
            with open(path) as f:
                _models[key] = json.load(f)
            logger.info(f"✓ Loaded {key}")
        except Exception as e:
            logger.warning(f"Could not load {key}: {e}")


load_models()


# ─────────────────────────────────────────────
# Feature definitions (must match training scripts)
# ─────────────────────────────────────────────
ZONE_FEATURE_COLS = [
    "rain_days_this_week",
    "total_rain_mm",
    "max_single_day_rain_mm",
    "mean_rain_intensity_mm_per_hour",
    "heat_days_over_40c",
    "rain_event_count_30d",
    "waterlogging_score",
    "store_reliability_score",
]

FRAUD_FEATURE_COLS = [
    "claim_rate_per_week",
    "earnings_declared_vs_avg_ratio",
    "zone_consistency_score",
    "active_days_ratio",
    "policy_age_days",
    "claim_to_premium_ratio",
    "night_claim_ratio",
    "trigger_type_diversity",
    "avg_payout_requested",
    "multi_zone_claim_flag",
]

# Zone statics — matches training data
ZONE_STATICS = {
    "z-koramangala":  {"waterlogging_score": 0.85, "store_reliability": 0.72},
    "z-indiranagar":  {"waterlogging_score": 0.55, "store_reliability": 0.88},
    "z-whitefield":   {"waterlogging_score": 0.45, "store_reliability": 0.91},
    "z-hsr-layout":   {"waterlogging_score": 0.70, "store_reliability": 0.80},
    "z-jp-nagar":     {"waterlogging_score": 0.60, "store_reliability": 0.84},
}


# ─────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────
def _zone_risk_available() -> bool:
    return _models["zone_risk"] is not None and _models["zone_risk_scaler"] is not None


def _fraud_available() -> bool:
    return _models["fraud"] is not None and _models["fraud_scaler"] is not None


def _normalise_fraud_score(raw_score: float) -> float:
    """
    Map Isolation Forest score_samples output to [0.0, 1.0].
    raw_score is negative: more negative = more anomalous.
    We use the training distribution bounds stored in meta.
    """
    meta = _models.get("fraud_meta") or {}
    eval_data = meta.get("evaluation", {})
    s_min = eval_data.get("score_min_raw", -0.5)
    s_max = eval_data.get("score_max_raw", 0.1)
    score_range = s_max - s_min or 1.0
    normalised = 1.0 - (raw_score - s_min) / score_range
    return float(np.clip(normalised, 0.0, 1.0))


# ─────────────────────────────────────────────
# Routes
# ─────────────────────────────────────────────

@app.route("/health")
def health():
    return jsonify({
        "status": "ok",
        "models": {
            "zone_risk": _zone_risk_available(),
            "fraud": _fraud_available(),
        },
        "startup_errors": _startup_errors,
        "timestamp": datetime.utcnow().isoformat() + "Z",
    })


@app.route("/model-meta")
def model_meta():
    """Expose model metadata for the Explainability Card and judge demo."""
    return jsonify({
        "zone_risk": _models.get("zone_risk_meta"),
        "fraud": _models.get("fraud_meta"),
    })


@app.route("/score-zone", methods=["POST"])
def score_zone():
    """
    Inputs (JSON body):
      zone_id                         — string (e.g. "z-koramangala")
      rain_days_this_week             — int 0–7
      total_rain_mm                   — float
      max_single_day_rain_mm          — float
      mean_rain_intensity_mm_per_hour — float
      heat_days_over_40c              — int 0–7
      rain_event_count_30d            — int

    Returns:
      risk_multiplier  — float 0.80–1.40
      features_used    — dict (for explainability card)
      model_used       — "gbr" | "fallback"
      zone_statics     — waterlogging_score, store_reliability_score
    """
    if not request.is_json:
        return jsonify({"error": "Content-Type must be application/json"}), 400

    data = request.get_json()
    zone_id = data.get("zone_id", "z-koramangala")

    # Get zone statics (fallback to midpoint values if unknown zone)
    statics = ZONE_STATICS.get(zone_id, {"waterlogging_score": 0.60, "store_reliability": 0.82})

    # Build feature vector — use defaults for missing fields
    features = {
        "rain_days_this_week":             float(data.get("rain_days_this_week", 0)),
        "total_rain_mm":                   float(data.get("total_rain_mm", 0.0)),
        "max_single_day_rain_mm":          float(data.get("max_single_day_rain_mm", 0.0)),
        "mean_rain_intensity_mm_per_hour": float(data.get("mean_rain_intensity_mm_per_hour", 0.0)),
        "heat_days_over_40c":              float(data.get("heat_days_over_40c", 0)),
        "rain_event_count_30d":            float(data.get("rain_event_count_30d", 0)),
        "waterlogging_score":              statics["waterlogging_score"],
        "store_reliability_score":         statics["store_reliability"],
    }

    if not _zone_risk_available():
        logger.warning("[score-zone] Models not loaded, returning fallback 1.0")
        return jsonify({
            "risk_multiplier": 1.0,
            "features_used": features,
            "model_used": "fallback_model_not_loaded",
            "zone_statics": statics,
        })

    try:
        X = np.array([[features[f] for f in ZONE_FEATURE_COLS]])
        X_scaled = _models["zone_risk_scaler"].transform(X)
        raw_pred = float(_models["zone_risk"].predict(X_scaled)[0])
        multiplier = float(np.clip(raw_pred, 0.80, 1.40))

        logger.info(f"[score-zone] zone={zone_id} multiplier={multiplier:.4f}")

        return jsonify({
            "risk_multiplier": round(multiplier, 4),
            "features_used": features,
            "model_used": "gbr",
            "zone_statics": statics,
        })

    except Exception as e:
        logger.error(f"[score-zone] Inference error: {e}\n{traceback.format_exc()}")
        return jsonify({
            "risk_multiplier": 1.0,
            "features_used": features,
            "model_used": "fallback_inference_error",
            "error": str(e),
        }), 500


@app.route("/fraud-check", methods=["POST"])
def fraud_check():
    """
    Inputs (JSON body — sent by Node.js fraud.service.callMlFraudCheck):
      rider_id                  — string (UUID, not used in model, logged only)
      zone_id                   — string
      trigger_type              — string (rain_burst | heat | aqi | curfew | dark_store_closure)
      declared_daily_earnings   — float (INR)
      claim_amount              — float (INR)

    Derived features computed server-side from rider history:
    The Node.js backend can optionally pass pre-computed behavioural features.
    If not provided, we compute defaults from the basic inputs.

    Returns:
      anomaly_score  — float 0.0–1.0 (higher = more fraudulent)
      model_used     — "isolation_forest" | "fallback"
      score_band     — "CLEAN" | "SUSPICIOUS" | "ANOMALOUS"
    """
    if not request.is_json:
        return jsonify({"error": "Content-Type must be application/json"}), 400

    data = request.get_json()

    rider_id = data.get("rider_id", "unknown")
    zone_id = data.get("zone_id", "unknown")
    trigger_type = data.get("trigger_type", "rain_burst")
    declared_earnings = float(data.get("declared_daily_earnings", 700.0))
    claim_amount = float(data.get("claim_amount", 120.0))

    # ── Feature construction ─────────────────────────────────
    # The Node.js backend can pass pre-computed features directly.
    # If not provided, we use conservative defaults (won't inflate fraud score).
    features = {
        "claim_rate_per_week": float(data.get("claim_rate_per_week", 0.5)),
        "earnings_declared_vs_avg_ratio": float(
            declared_earnings / max(data.get("platform_avg_daily_earnings", declared_earnings), 1.0)
        ),
        "zone_consistency_score": float(data.get("zone_consistency_score", 0.85)),
        "active_days_ratio": float(data.get("active_days_ratio", 0.70)),
        "policy_age_days": float(data.get("policy_age_days", 30.0)),
        "claim_to_premium_ratio": float(
            claim_amount / max(data.get("weekly_premium", max(claim_amount * 0.5, 1.0)), 1.0)
        ),
        "night_claim_ratio": float(data.get("night_claim_ratio", 0.05)),
        "trigger_type_diversity": _trigger_diversity(data.get("recent_trigger_types", [trigger_type])),
        "avg_payout_requested": float(claim_amount),
        "multi_zone_claim_flag": float(data.get("multi_zone_claim_flag", 0.0)),
    }

    # Clip to training ranges
    features = {
        "claim_rate_per_week":              float(np.clip(features["claim_rate_per_week"], 0, 10)),
        "earnings_declared_vs_avg_ratio":   float(np.clip(features["earnings_declared_vs_avg_ratio"], 0.1, 5.0)),
        "zone_consistency_score":           float(np.clip(features["zone_consistency_score"], 0, 1)),
        "active_days_ratio":                float(np.clip(features["active_days_ratio"], 0, 1)),
        "policy_age_days":                  float(np.clip(features["policy_age_days"], 0, 730)),
        "claim_to_premium_ratio":           float(np.clip(features["claim_to_premium_ratio"], 0, 20)),
        "night_claim_ratio":                float(np.clip(features["night_claim_ratio"], 0, 1)),
        "trigger_type_diversity":           float(np.clip(features["trigger_type_diversity"], 0, 1)),
        "avg_payout_requested":             float(np.clip(features["avg_payout_requested"], 0, 1000)),
        "multi_zone_claim_flag":            float(np.clip(features["multi_zone_claim_flag"], 0, 1)),
    }

    if not _fraud_available():
        logger.warning("[fraud-check] Models not loaded, returning fallback 0.0")
        return jsonify({
            "anomaly_score": 0.0,
            "model_used": "fallback_model_not_loaded",
            "score_band": "CLEAN",
            "features_used": features,
        })

    try:
        X = np.array([[features[f] for f in FRAUD_FEATURE_COLS]])
        X_scaled = _models["fraud_scaler"].transform(X)
        raw_score = float(_models["fraud"].score_samples(X_scaled)[0])
        anomaly_score = _normalise_fraud_score(raw_score)

        band = (
            "CLEAN" if anomaly_score < 0.30
            else "SUSPICIOUS" if anomaly_score < 0.60
            else "ANOMALOUS"
        )

        logger.info(
            f"[fraud-check] rider={rider_id} zone={zone_id} "
            f"anomaly={anomaly_score:.4f} band={band}"
        )

        return jsonify({
            "anomaly_score": round(anomaly_score, 4),
            "model_used": "isolation_forest",
            "score_band": band,
            "features_used": features,
        })

    except Exception as e:
        logger.error(f"[fraud-check] Inference error: {e}\n{traceback.format_exc()}")
        return jsonify({
            "anomaly_score": 0.0,
            "model_used": "fallback_inference_error",
            "score_band": "CLEAN",
            "error": str(e),
        }), 500


def _trigger_diversity(recent_types: list) -> float:
    """
    Compute trigger type diversity (0.0–1.0).
    All same type = 0.0, all different = 1.0.
    5 possible types: rain_burst, heat, aqi, curfew, dark_store_closure
    """
    n_types = 5
    unique = len(set(recent_types)) if recent_types else 1
    return round((unique - 1) / (n_types - 1), 4)


# ─────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    debug = os.environ.get("FLASK_DEBUG", "false").lower() == "true"
    logger.info(f"ZapShield ML service starting on port {port}")
    app.run(host="0.0.0.0", port=port, debug=debug)
