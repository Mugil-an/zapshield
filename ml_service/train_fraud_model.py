"""
ZapShield — Fraud Anomaly Model (Phase 3)
==========================================
Generates 1,000+ synthetic rider profiles with behavioural patterns,
trains an Isolation Forest anomaly detector, and saves the model.

Why Isolation Forest?
- Unsupervised: no labelled fraud dataset needed (realistic for a startup)
- Industry-standard for insurance anomaly detection
- Returns a continuous anomaly score (0.0–1.0) — fits our weighted fraud pipeline
- Fast inference (<1ms per claim)
- IRDAI-acceptable: purely behavioural, no demographics

Feature engineering rationale (insurance-grade):
Each feature reflects a real fraud signal observed in gig-economy parametric claims:

  claim_rate_per_week       — normal riders file 0–1, fraudsters file 2–4+
  earnings_declared_vs_avg  — fraudsters over-declare to inflate payouts
  zone_consistency_score    — fraudsters jump zones to chase triggers
  active_days_ratio         — fraudsters have suspiciously low activity before claims
  policy_age_days           — day-one policy abuse is a known pattern
  claim_to_premium_ratio    — legitimate ratio is 0.3–2.5; fraud often >4.0
  night_claim_ratio         — legitimate workers don't file at 3AM
  trigger_type_diversity    — fraudsters claim across all trigger types, not just 1
  avg_payout_requested      — legitimate ₹80–₹200; fraud often ₹500+
  multi_zone_claims         — claiming in >1 zone in same week = red flag
"""

import json
import os

import joblib
import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler

FEATURE_COLS = [
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


def generate_synthetic_profiles(n_legitimate: int = 850, n_fraud: int = 200) -> tuple:
    """
    Generate realistic rider profiles.

    Legitimate riders (~85%):
    - File 0–1 claims/week on average
    - Consistent zone (work in 1 area)
    - Active most days before claiming
    - Reasonable earnings declaration

    Fraud patterns modelled (4 archetypes):
    1. Claim farmer:        high claim rate, new policy, all trigger types
    2. Earnings inflator:   over-declares income, high payout requests
    3. Zone jumper:         low zone consistency, multi-zone claims
    4. Activity fraudster:  zero activity before trigger, suspiciously perfect timing
    """
    rng = np.random.default_rng(seed=42)

    def legit_profile():
        return {
            "claim_rate_per_week": rng.beta(1.2, 8.0),              # mostly <0.3
            "earnings_declared_vs_avg_ratio": rng.normal(1.0, 0.12),# centred at 1.0
            "zone_consistency_score": rng.beta(8.0, 2.0),           # mostly >0.7
            "active_days_ratio": rng.beta(5.0, 2.0),                # mostly >0.5
            "policy_age_days": float(rng.integers(7, 365)),
            "claim_to_premium_ratio": rng.exponential(0.8),         # avg 0.8
            "night_claim_ratio": rng.beta(1.0, 12.0),               # rarely at night
            "trigger_type_diversity": rng.beta(1.5, 6.0),           # usually 1 type
            "avg_payout_requested": rng.normal(140.0, 40.0),        # ₹80–₹250
            "multi_zone_claim_flag": float(rng.random() < 0.05),    # 5% chance
        }

    def fraud_claim_farmer():
        """Files 3–5 claims/week, new policy, all trigger types"""
        return {
            "claim_rate_per_week": rng.uniform(2.5, 5.0),
            "earnings_declared_vs_avg_ratio": rng.normal(1.1, 0.1),
            "zone_consistency_score": rng.beta(4.0, 3.0),
            "active_days_ratio": rng.beta(2.0, 4.0),                # low activity
            "policy_age_days": float(rng.integers(1, 10)),          # day-one abuse
            "claim_to_premium_ratio": rng.uniform(4.0, 8.0),
            "night_claim_ratio": rng.beta(3.0, 3.0),
            "trigger_type_diversity": rng.beta(5.0, 2.0),           # diverse triggers
            "avg_payout_requested": rng.normal(300.0, 80.0),
            "multi_zone_claim_flag": float(rng.random() < 0.60),
        }

    def fraud_earnings_inflator():
        """Massively over-declares income, high payout amounts"""
        return {
            "claim_rate_per_week": rng.uniform(0.8, 2.0),
            "earnings_declared_vs_avg_ratio": rng.normal(2.8, 0.4), # 3x average
            "zone_consistency_score": rng.beta(5.0, 2.0),
            "active_days_ratio": rng.beta(4.0, 2.0),
            "policy_age_days": float(rng.integers(30, 180)),
            "claim_to_premium_ratio": rng.uniform(5.0, 12.0),
            "night_claim_ratio": rng.beta(1.5, 8.0),
            "trigger_type_diversity": rng.beta(2.0, 5.0),
            "avg_payout_requested": rng.normal(550.0, 120.0),       # ₹400–₹700
            "multi_zone_claim_flag": float(rng.random() < 0.15),
        }

    def fraud_zone_jumper():
        """Claims in multiple zones, low consistency"""
        return {
            "claim_rate_per_week": rng.uniform(1.5, 3.5),
            "earnings_declared_vs_avg_ratio": rng.normal(1.2, 0.15),
            "zone_consistency_score": rng.beta(1.5, 6.0),           # very low
            "active_days_ratio": rng.beta(3.0, 4.0),
            "policy_age_days": float(rng.integers(5, 60)),
            "claim_to_premium_ratio": rng.uniform(3.0, 6.0),
            "night_claim_ratio": rng.beta(2.0, 5.0),
            "trigger_type_diversity": rng.beta(4.0, 2.0),
            "avg_payout_requested": rng.normal(220.0, 60.0),
            "multi_zone_claim_flag": float(rng.random() < 0.85),    # almost always
        }

    def fraud_zero_activity():
        """Zero deliveries before trigger — clearly not working when disrupted"""
        return {
            "claim_rate_per_week": rng.uniform(1.0, 2.5),
            "earnings_declared_vs_avg_ratio": rng.normal(1.3, 0.2),
            "zone_consistency_score": rng.beta(5.0, 3.0),
            "active_days_ratio": rng.beta(0.5, 5.0),               # very low
            "policy_age_days": float(rng.integers(3, 30)),
            "claim_to_premium_ratio": rng.uniform(2.5, 5.0),
            "night_claim_ratio": rng.beta(4.0, 3.0),               # suspiciously at night
            "trigger_type_diversity": rng.beta(2.0, 4.0),
            "avg_payout_requested": rng.normal(180.0, 50.0),
            "multi_zone_claim_flag": float(rng.random() < 0.30),
        }

    # ── Assemble dataset ────────────────────────────────────────
    profiles = []
    labels = []  # 0 = legit, 1 = fraud (only for evaluation, not used in training)

    for _ in range(n_legitimate):
        profiles.append(legit_profile())
        labels.append(0)

    fraud_generators = [fraud_claim_farmer, fraud_earnings_inflator,
                        fraud_zone_jumper, fraud_zero_activity]
    fraud_per_type = n_fraud // len(fraud_generators)

    for gen in fraud_generators:
        for _ in range(fraud_per_type):
            profiles.append(gen())
            labels.append(1)

    return profiles, labels


def clip_features(profiles: list[dict]) -> list[dict]:
    """Clip to physically meaningful ranges — same clipping applied at inference."""
    clipped = []
    for p in profiles:
        clipped.append({
            "claim_rate_per_week": float(np.clip(p["claim_rate_per_week"], 0, 10)),
            "earnings_declared_vs_avg_ratio": float(np.clip(p["earnings_declared_vs_avg_ratio"], 0.1, 5.0)),
            "zone_consistency_score": float(np.clip(p["zone_consistency_score"], 0, 1)),
            "active_days_ratio": float(np.clip(p["active_days_ratio"], 0, 1)),
            "policy_age_days": float(np.clip(p["policy_age_days"], 0, 730)),
            "claim_to_premium_ratio": float(np.clip(p["claim_to_premium_ratio"], 0, 20)),
            "night_claim_ratio": float(np.clip(p["night_claim_ratio"], 0, 1)),
            "trigger_type_diversity": float(np.clip(p["trigger_type_diversity"], 0, 1)),
            "avg_payout_requested": float(np.clip(p["avg_payout_requested"], 0, 1000)),
            "multi_zone_claim_flag": float(np.clip(p["multi_zone_claim_flag"], 0, 1)),
        })
    return clipped


def train_model(profiles: list[dict], labels: list[int]) -> tuple:
    """
    Train Isolation Forest.

    contamination=0.15: we model ~15% anomaly rate in the training set
    (consistent with our 850 legit / 200 fraud split)

    n_estimators=200: more trees = more stable anomaly scores
    max_samples='auto': uses min(256, n_samples) — standard setting
    """
    X = np.array([[p[f] for f in FEATURE_COLS] for p in profiles])
    y = np.array(labels)

    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    model = IsolationForest(
        n_estimators=200,
        contamination=0.15,
        max_samples="auto",
        random_state=42,
        n_jobs=-1,
    )
    model.fit(X_scaled)

    # Evaluate: Isolation Forest returns -1 (anomaly) or 1 (normal)
    preds = model.predict(X_scaled)
    # Convert to 0/1: anomaly=-1 → 1, normal=1 → 0
    pred_binary = (preds == -1).astype(int)

    true_pos = int(np.sum((pred_binary == 1) & (y == 1)))
    false_pos = int(np.sum((pred_binary == 1) & (y == 0)))
    true_neg = int(np.sum((pred_binary == 0) & (y == 0)))
    false_neg = int(np.sum((pred_binary == 0) & (y == 1)))

    precision = true_pos / (true_pos + false_pos + 1e-9)
    recall = true_pos / (true_pos + false_neg + 1e-9)
    f1 = 2 * precision * recall / (precision + recall + 1e-9)

    # Raw score distribution: lower score from IF = more anomalous
    # Map to 0–1: anomaly_score = 1 - (raw_score + 0.5) / 1.0 (approximate)
    raw_scores = model.score_samples(X_scaled)
    # Normalise: min_raw maps to score=1.0, max_raw maps to score=0.0
    # We invert: higher anomaly_score = more fraudulent
    score_min, score_max = raw_scores.min(), raw_scores.max()
    anomaly_scores = 1.0 - (raw_scores - score_min) / (score_max - score_min + 1e-9)

    legit_scores = anomaly_scores[y == 0]
    fraud_scores = anomaly_scores[y == 1]

    return model, scaler, {
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(f1, 4),
        "true_positives": true_pos,
        "false_positives": false_pos,
        "true_negatives": true_neg,
        "false_negatives": false_neg,
        "legit_score_mean": round(float(legit_scores.mean()), 4),
        "fraud_score_mean": round(float(fraud_scores.mean()), 4),
        "score_min_raw": float(score_min),
        "score_max_raw": float(score_max),
    }


def main():
    os.makedirs("models", exist_ok=True)

    print("=" * 60)
    print("ZapShield — Fraud Isolation Forest Training")
    print("=" * 60)

    # ── Step 1: Generate profiles ─────────────────────────────
    print("\n[1/4] Generating synthetic rider profiles...")
    profiles, labels = generate_synthetic_profiles(n_legitimate=850, n_fraud=200)
    profiles = clip_features(profiles)
    fraud_count = sum(labels)
    print(f"  Total profiles: {len(profiles)}")
    print(f"  Legitimate:     {len(profiles) - fraud_count} ({(1-fraud_count/len(profiles))*100:.0f}%)")
    print(f"  Fraud patterns: {fraud_count} ({fraud_count/len(profiles)*100:.0f}%)")
    print(f"  Features:       {len(FEATURE_COLS)}")

    # ── Step 2: Train ─────────────────────────────────────────
    print("\n[2/4] Training Isolation Forest...")
    model, scaler, metrics = train_model(profiles, labels)

    print(f"\n  Fraud detection metrics:")
    print(f"    Precision:          {metrics['precision']:.4f}  (of flagged, % truly fraud)")
    print(f"    Recall:             {metrics['recall']:.4f}  (of actual fraud, % caught)")
    print(f"    F1 Score:           {metrics['f1']:.4f}")
    print(f"    True Positives:     {metrics['true_positives']}")
    print(f"    False Positives:    {metrics['false_positives']}")
    print(f"  Anomaly score distribution:")
    print(f"    Legit riders avg:   {metrics['legit_score_mean']:.4f}  (want: <0.30)")
    print(f"    Fraud riders avg:   {metrics['fraud_score_mean']:.4f}  (want: >0.55)")

    # ── Step 3: Verify separation ─────────────────────────────
    separation = metrics["fraud_score_mean"] - metrics["legit_score_mean"]
    print(f"\n  Score separation:   {separation:.4f}  (want: >0.25 for usable signal)")
    if separation < 0.20:
        print("  ⚠ WARNING: Low separation — consider adding more fraud archetypes")
    else:
        print("  ✓ PASS: Model produces usable anomaly signal")

    # ── Step 4: Persist ───────────────────────────────────────
    print("\n[3/4] Saving model artifacts...")
    joblib.dump(model, "models/fraud_model.joblib")
    joblib.dump(scaler, "models/fraud_scaler.joblib")

    meta = {
        "model": "IsolationForest",
        "trained_on": str(np.datetime64("today")),
        "n_profiles": len(profiles),
        "n_fraud_profiles": fraud_count,
        "contamination": 0.15,
        "n_estimators": 200,
        "feature_columns": FEATURE_COLS,
        "evaluation": metrics,
        "score_interpretation": {
            "0.0_to_0.30": "CLEAN — consistent with legitimate claim",
            "0.30_to_0.60": "SUSPICIOUS — rule layer likely already flagged",
            "0.60_to_1.0":  "ANOMALOUS — strong fraud signal, auto-flag or reject",
        },
        "fraud_archetypes_modelled": [
            "claim_farmer",
            "earnings_inflator",
            "zone_jumper",
            "zero_activity",
        ],
    }
    with open("models/fraud_model_meta.json", "w") as f:
        json.dump(meta, f, indent=2)

    print(f"  models/fraud_model.joblib     ✓")
    print(f"  models/fraud_scaler.joblib    ✓")
    print(f"  models/fraud_model_meta.json  ✓")
    print(f"\n{'='*60}")
    print(f"  Training complete. F1 = {metrics['f1']:.4f}")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
