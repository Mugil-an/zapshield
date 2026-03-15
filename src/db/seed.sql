-- ZapShield seed data for local development

-- Insert Bengaluru zones
INSERT INTO zones (id, dark_store_name, city, lat, lng, radius_meters, current_risk_multiplier)
VALUES
  (uuid_generate_v4(), 'Koramangala',  'Bengaluru', 12.9352, 77.6245, 500, 1.35),
  (uuid_generate_v4(), 'Indiranagar',  'Bengaluru', 12.9784, 77.6408, 500, 1.10),
  (uuid_generate_v4(), 'HSR Layout',   'Bengaluru', 12.9116, 77.6389, 500, 1.20),
  (uuid_generate_v4(), 'Whitefield',   'Bengaluru', 12.9698, 77.7500, 500, 0.90),
  (uuid_generate_v4(), 'JP Nagar',     'Bengaluru', 12.9102, 77.5847, 500, 0.85);

-- Insert riders linked to zones by name
INSERT INTO riders (id, mobile, name, zone_id, declared_daily_earnings, kyc_verified, is_active)
SELECT
  uuid_generate_v4(),
  '9876543210' AS mobile,
  'Ravi'       AS name,
  z.id         AS zone_id,
  750.00       AS declared_daily_earnings,
  TRUE         AS kyc_verified,
  TRUE         AS is_active
FROM zones z
WHERE z.dark_store_name = 'Koramangala'
LIMIT 1;

INSERT INTO riders (id, mobile, name, zone_id, declared_daily_earnings, kyc_verified, is_active)
SELECT
  uuid_generate_v4(),
  '9876543211' AS mobile,
  'Priya'      AS name,
  z.id         AS zone_id,
  600.00       AS declared_daily_earnings,
  TRUE         AS kyc_verified,
  TRUE         AS is_active
FROM zones z
WHERE z.dark_store_name = 'Indiranagar'
LIMIT 1;

INSERT INTO riders (id, mobile, name, zone_id, declared_daily_earnings, kyc_verified, is_active)
SELECT
  uuid_generate_v4(),
  '9876543212' AS mobile,
  'Arjun'      AS name,
  z.id         AS zone_id,
  900.00       AS declared_daily_earnings,
  FALSE        AS kyc_verified,
  TRUE         AS is_active
FROM zones z
WHERE z.dark_store_name = 'HSR Layout'
LIMIT 1;

-- Seed admin user with bcrypt hash for "Admin@1234"
INSERT INTO admin_users (id, email, password_hash, role, is_active)
VALUES (
  uuid_generate_v4(),
  'admin@zapshield.in',
  '$2b$10$SUlpkfV.7rbTqfMFC7WszeWGd95t3c/bFtTefsmsN.eIdHskaNm6u', -- bcrypt("Admin@1234")
  'super_admin',
  TRUE
);

-- Seed one active standard-tier policy for Ravi
WITH rider_ravi AS (
  SELECT r.id AS rider_id, r.zone_id
  FROM riders r
  WHERE r.mobile = '9876543210'
  LIMIT 1
),
zone_for_ravi AS (
  SELECT z.id AS zone_id
  FROM zones z
  JOIN rider_ravi rr ON rr.zone_id = z.id
  LIMIT 1
),
coverage_window AS (
  -- Coverage window aligned to this week in IST:
  -- Monday 00:00 IST to Sunday 23:59:59 IST
  SELECT
    (date_trunc('week', NOW() AT TIME ZONE 'Asia/Kolkata')) AT TIME ZONE 'Asia/Kolkata' AS coverage_start_utc,
    ((date_trunc('week', NOW() AT TIME ZONE 'Asia/Kolkata') + INTERVAL '7 days') - INTERVAL '1 second')
      AT TIME ZONE 'Asia/Kolkata' AS coverage_end_utc
)
INSERT INTO policies (
  id,
  rider_id,
  zone_id,
  tier,
  base_premium,
  zone_risk_multiplier,
  season_factor,
  tenure_discount,
  final_weekly_premium,
  max_weekly_payout,
  coverage_start,
  coverage_end,
  status,
  payment_verified,
  total_claimed_this_week
)
SELECT
  uuid_generate_v4()                      AS id,
  rr.rider_id                             AS rider_id,
  z.zone_id                               AS zone_id,
  'standard'::policy_tier                 AS tier,
  49.00                                   AS base_premium,
  1.35                                    AS zone_risk_multiplier,
  1.25                                    AS season_factor,
  0.97                                    AS tenure_discount,
  80.00                                   AS final_weekly_premium,
  600.00                                  AS max_weekly_payout,
  '2026-03-16 00:00:00+05:30'            AS coverage_start,
  '2026-03-22 23:59:59+05:30'            AS coverage_end,
  'active'::policy_status                 AS status,
  TRUE                                    AS payment_verified,
  0.00                                    AS total_claimed_this_week
FROM rider_ravi rr
JOIN zone_for_ravi z ON z.zone_id = rr.zone_id
CROSS JOIN coverage_window cw;

