-- ZapShield Schema | Coverage: Income loss ONLY | Claims: Auto-trigger ONLY

-- ============================================================
-- ZapShield PostgreSQL Schema
-- Coverage: Income loss ONLY | Premiums: Weekly ONLY
-- Claims: Parametric auto-trigger ONLY (never manually filed)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─────────────────────────────────────────────
-- ZONES (500m radius dark store service areas)
-- ─────────────────────────────────────────────
CREATE TABLE zones (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  dark_store_name         VARCHAR(100) NOT NULL,
  city                    VARCHAR(50)  NOT NULL,
  lat                     DECIMAL(9,6) NOT NULL,
  lng                     DECIMAL(9,6) NOT NULL,
  radius_meters           INT          NOT NULL DEFAULT 500,
  current_risk_multiplier DECIMAL(4,2) NOT NULL DEFAULT 1.00,
  -- risk_multiplier range: 0.80 (safe zone) to 1.40 (high-risk zone)
  last_risk_scored_at     TIMESTAMPTZ,
  is_active               BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- RIDERS
-- ─────────────────────────────────────────────
CREATE TABLE riders (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mobile                  VARCHAR(15)  NOT NULL UNIQUE,
  name                    VARCHAR(100),
  partner_id              VARCHAR(50),   -- Zepto/Blinkit partner ID (KYC)
  aadhaar_last4           CHAR(4),       -- Last 4 digits only, never full Aadhaar
  zone_id                 UUID         REFERENCES zones(id),
  declared_daily_earnings DECIMAL(8,2),  -- Rider's self-declared avg daily income (INR)
  kyc_verified            BOOLEAN      NOT NULL DEFAULT FALSE,
  is_active               BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- OTP (for mobile-based auth — mocked in dev)
-- ─────────────────────────────────────────────
CREATE TABLE otps (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mobile      VARCHAR(15)  NOT NULL,
  otp_hash    VARCHAR(255) NOT NULL,  -- bcrypt hash of 6-digit OTP
  expires_at  TIMESTAMPTZ  NOT NULL,
  used        BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- POLICIES (weekly binding — 7 days exactly)
-- ─────────────────────────────────────────────
CREATE TYPE policy_tier AS ENUM ('basic', 'standard', 'premium');
CREATE TYPE policy_status AS ENUM ('active', 'expired', 'cancelled');

CREATE TABLE policies (
  id                    UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  rider_id              UUID          NOT NULL REFERENCES riders(id),
  zone_id               UUID          NOT NULL REFERENCES zones(id),
  tier                  policy_tier   NOT NULL,
  -- Weekly premium breakdown (stored for explainability card)
  base_premium          DECIMAL(8,2)  NOT NULL,  -- tier base before adjustments
  zone_risk_multiplier  DECIMAL(4,2)  NOT NULL,  -- zone multiplier at time of bind
  season_factor         DECIMAL(4,2)  NOT NULL,  -- seasonal adjustment
  tenure_discount       DECIMAL(4,2)  NOT NULL,  -- loyalty discount
  final_weekly_premium  DECIMAL(8,2)  NOT NULL,  -- what rider actually paid
  -- Coverage
  max_weekly_payout     DECIMAL(8,2)  NOT NULL,  -- coverage cap for this week
  -- Duration — always exactly 7 days
  coverage_start        TIMESTAMPTZ   NOT NULL,
  coverage_end          TIMESTAMPTZ   NOT NULL,  -- = coverage_start + 7 days
  -- Status
  status                policy_status NOT NULL DEFAULT 'active',
  -- Payment reference
  razorpay_order_id     VARCHAR(100),
  razorpay_payment_id   VARCHAR(100),
  payment_verified      BOOLEAN       NOT NULL DEFAULT FALSE,
  -- Totals updated as claims are paid
  total_claimed_this_week DECIMAL(8,2) NOT NULL DEFAULT 0.00,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- TRIGGER EVENTS (parametric events detected by engine)
-- ─────────────────────────────────────────────
CREATE TYPE trigger_type AS ENUM (
  'rain_burst',      -- rainfall >= 4mm in 15 min
  'extreme_heat',    -- temp >= 40°C for 30+ min during 12pm-4pm
  'severe_aqi',      -- AQI >= 300 for 2+ hours
  'store_closure',   -- dark store unexpectedly closed (mocked)
  'curfew'           -- Section 144 or zone lockdown (mocked)
);

CREATE TABLE trigger_events (
  id                        UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  zone_id                   UUID          NOT NULL REFERENCES zones(id),
  trigger_type              trigger_type  NOT NULL,
  -- What was measured
  threshold_value           DECIMAL(10,4) NOT NULL,  -- configured threshold
  actual_value              DECIMAL(10,4) NOT NULL,  -- measured value that breached
  -- Dark store dispatch correlation (anti-fraud signal)
  dispatch_volume_pct       DECIMAL(5,2),
  -- ^^ % of baseline orders dispatched during this window (NULL for curfew/AQI)
  -- If dispatch_volume_pct > 40.00, trigger is fraud-suspect
  -- API sources
  api_source                VARCHAR(100)  NOT NULL,  -- 'open-meteo', 'mock-zepto', etc.
  raw_api_response          JSONB,                   -- full API response stored for audit
  -- Duration
  event_start               TIMESTAMPTZ   NOT NULL,
  event_end                 TIMESTAMPTZ,             -- NULL = still ongoing
  duration_hours            DECIMAL(4,2),            -- computed on close
  -- Processing
  processed                 BOOLEAN       NOT NULL DEFAULT FALSE,
  processed_at              TIMESTAMPTZ,
  claims_generated          INT           NOT NULL DEFAULT 0,
  created_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- CLAIMS (auto-created by trigger engine ONLY)
-- IMPORTANT: No manual submission. No rider-facing POST endpoint.
-- ─────────────────────────────────────────────
CREATE TYPE claim_status AS ENUM (
  'pending_fraud_check',  -- just created, fraud check running
  'approved',             -- passed fraud check, queued for payout
  'paid',                 -- payout successfully sent
  'flagged',              -- failed fraud check, held for insurer review
  'rejected'              -- insurer rejected after review
);

CREATE TABLE claims (
  id                    UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  policy_id             UUID          NOT NULL REFERENCES policies(id),
  trigger_event_id      UUID          NOT NULL REFERENCES trigger_events(id),
  rider_id              UUID          NOT NULL REFERENCES riders(id),
  -- Payout calculation
  hourly_rate           DECIMAL(8,2)  NOT NULL,  -- from tier at time of event
  trigger_multiplier    DECIMAL(4,2)  NOT NULL,  -- per trigger type
  duration_hours        DECIMAL(4,2)  NOT NULL,
  calculated_payout     DECIMAL(8,2)  NOT NULL,  -- before cap
  approved_payout       DECIMAL(8,2)  NOT NULL,  -- after weekly cap applied
  -- Fraud detection
  fraud_score           DECIMAL(5,4),            -- 0.0000 = clean, 1.0000 = fraud
  fraud_flags           JSONB,                   -- array of flag reason strings
  -- ^^ Example: ["dispatch_volume_high", "gps_outside_zone"]
  -- Status
  status                claim_status  NOT NULL DEFAULT 'pending_fraud_check',
  -- Payout reference
  razorpay_payout_id    VARCHAR(100),
  payout_initiated_at   TIMESTAMPTZ,
  payout_completed_at   TIMESTAMPTZ,
  -- Audit
  auto_created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  -- NOTE: No created_by, no submitted_by — claims are ALWAYS auto-generated
  reviewed_by_admin_id  UUID,         -- only set if insurer manually reviews
  reviewed_at           TIMESTAMPTZ
);

-- ─────────────────────────────────────────────
-- ADMIN USERS (insurer dashboard users)
-- ─────────────────────────────────────────────
CREATE TABLE admin_users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role          VARCHAR(50)  NOT NULL DEFAULT 'insurer_analyst',
  -- roles: 'insurer_analyst', 'insurer_admin', 'super_admin'
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- ZONE RISK HISTORY (ML model outputs stored weekly)
-- ─────────────────────────────────────────────
CREATE TABLE zone_risk_history (
  id                UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  zone_id           UUID          NOT NULL REFERENCES zones(id),
  week_start        DATE          NOT NULL,
  risk_multiplier   DECIMAL(4,2)  NOT NULL,
  ml_feature_vector JSONB,        -- features used to compute this score
  computed_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────
CREATE INDEX idx_riders_mobile     ON riders(mobile);
CREATE INDEX idx_riders_zone       ON riders(zone_id);
CREATE INDEX idx_policies_rider    ON policies(rider_id);
CREATE INDEX idx_policies_status   ON policies(status);
CREATE INDEX idx_policies_dates    ON policies(coverage_start, coverage_end);
CREATE INDEX idx_trigger_zone      ON trigger_events(zone_id);
CREATE INDEX idx_trigger_type      ON trigger_events(trigger_type);
CREATE INDEX idx_trigger_processed ON trigger_events(processed);
CREATE INDEX idx_claims_policy     ON claims(policy_id);
CREATE INDEX idx_claims_rider      ON claims(rider_id);
CREATE INDEX idx_claims_status     ON claims(status);
CREATE INDEX idx_claims_trigger    ON claims(trigger_event_id);

-- Additional Performance Indexes
CREATE INDEX IF NOT EXISTS idx_otps_mobile
  ON otps(mobile);
CREATE INDEX IF NOT EXISTS idx_otps_expires
  ON otps(expires_at) WHERE used = false;
CREATE INDEX IF NOT EXISTS idx_policies_coverage
  ON policies(coverage_end) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_claims_auto_created
  ON claims(auto_created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trigger_events_zone_type
  ON trigger_events(zone_id, trigger_type, processed);
CREATE INDEX IF NOT EXISTS idx_zone_risk_history_zone_week
  ON zone_risk_history(zone_id, week_start DESC);

