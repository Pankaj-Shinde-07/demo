-- copilot-map.sql — map the SynthBank synth_* estate into the NEXA Copilot's
-- native CMDB tables (cmdb_* + tenant_data_sources), so the REAL Copilot grounds
-- its answers on SynthBank. SYNTHETIC ONLY. Idempotent (safe to re-run).
--
-- Load order (see README):  copilot migrations → synthbank/schema.sql →
-- synthbank/seed.sql → THIS FILE.
--
-- Mapping (synth_* → Copilot golden_signal jsonb on cmdb_configuration_items.attributes):
--   status       -> availability_state        (up | degraded | down)
--   cpu_pct      -> cpu_saturation_pct
--   mem_pct      -> memory_saturation_pct
--   disk_pct     -> primary_saturation_pct (+ primary_metric = 'disk')
--   response_ms  -> latency_ms
--   (a metric the CI does NOT report is written as JSON null — "absent", never a
--    false zero — preserving the honest-empty contract the scorecard checks.)
--   uptime_s / availability_pct / if_*_bps have no Copilot golden-signal field and
--   are intentionally not surfaced (the Copilot does not model uptime → "no data").

BEGIN;

-- The tenant the Copilot's chat controller defaults to (DEFAULT_TENANT).
INSERT INTO tenants (id, name, industry, deployment_profile)
VALUES ('cfc5801f-db4e-454c-a14a-4732d9eac48a', 'SynthBank (synthetic)', 'banking', 'standalone')
ON CONFLICT (id) DO NOTHING;

-- Register the native canaris_ems data source for the tenant (capabilities set below).
INSERT INTO tenant_data_sources (tenant_id, provider_name, provider_type, enabled, cmdb_capabilities)
VALUES ('cfc5801f-db4e-454c-a14a-4732d9eac48a', 'canaris_ems', 'native', TRUE, '{}'::jsonb)
ON CONFLICT DO NOTHING;

-- ── Business services ────────────────────────────────────────────────────────
INSERT INTO cmdb_business_services (tenant_id, name, criticality_tier, source)
SELECT 'cfc5801f-db4e-454c-a14a-4732d9eac48a', s.name, 'unknown', 'canaris_ems'
FROM synth_cmdb_service s
ON CONFLICT DO NOTHING;

-- ── Configuration items (+ golden_signal telemetry in attributes jsonb) ──────
WITH piv AS (
  SELECT c.id AS ext,
         c.kind,
         c.hostname,
         c.status,
         max(m.value) FILTER (WHERE m.metric = 'cpu_pct')     AS cpu,
         max(m.value) FILTER (WHERE m.metric = 'mem_pct')     AS mem,
         max(m.value) FILTER (WHERE m.metric = 'disk_pct')    AS disk,
         max(m.value) FILTER (WHERE m.metric = 'response_ms') AS resp
  FROM synth_cmdb_ci c
  LEFT JOIN synth_ci_metric_sample m ON m.ci_id = c.id
  GROUP BY c.id, c.kind, c.hostname, c.status
)
INSERT INTO cmdb_configuration_items
  (tenant_id, ci_external_id, ci_type, name, description, criticality_tier, source, attributes)
SELECT
  'cfc5801f-db4e-454c-a14a-4732d9eac48a',
  piv.ext,
  CASE piv.kind
    WHEN 'app'     THEN 'application'
    WHEN 'web'     THEN 'application'
    WHEN 'db'      THEN 'database'
    WHEN 'host'    THEN 'server'
    WHEN 'network' THEN 'network_device'
    ELSE piv.kind
  END,
  piv.ext,                    -- name == external id so narration echoes 'IB-APP-01'
  piv.hostname,
  'unknown',
  'canaris_ems',
  jsonb_build_object(
    'golden_signal', jsonb_build_object(
      'availability_state',    piv.status,
      'cpu_saturation_pct',    piv.cpu,
      'memory_saturation_pct', piv.mem,
      'primary_saturation_pct',piv.disk,
      'primary_metric',        CASE WHEN piv.disk IS NOT NULL THEN 'disk' ELSE NULL END,
      'latency_ms',            piv.resp,
      'packet_loss_pct',       NULL,
      'last_reading_at',       '2026-07-13T00:00:00.000Z'
    )
  )
FROM piv
ON CONFLICT DO NOTHING;

-- ── Service ↔ CI links ───────────────────────────────────────────────────────
INSERT INTO cmdb_service_ci_links (tenant_id, service_id, ci_id, role)
SELECT 'cfc5801f-db4e-454c-a14a-4732d9eac48a', bs.id, ci.id, 'dependency'
FROM synth_cmdb_ci sc
JOIN synth_cmdb_service ss ON ss.id = sc.service_id
JOIN cmdb_business_services bs
  ON bs.name = ss.name AND bs.tenant_id = 'cfc5801f-db4e-454c-a14a-4732d9eac48a'
JOIN cmdb_configuration_items ci
  ON ci.ci_external_id = sc.id AND ci.tenant_id = 'cfc5801f-db4e-454c-a14a-4732d9eac48a'
ON CONFLICT DO NOTHING;

-- ── Services as resolvable CI nodes ──────────────────────────────────────────
-- The Copilot's entity resolver resolves CIs (not the separate services table),
-- and its native estate models business applications AS CIs. So represent each
-- SynthBank service ALSO as a CI (canonical name) with a rolled-up availability
-- (down if any member down, else degraded if any degraded, else up) so service-
-- level questions ("health of Internet Banking") resolve and ground.
WITH roll AS (
  SELECT ss.id AS sid, ss.name AS sname,
         CASE WHEN bool_or(sc.status='down')     THEN 'down'
              WHEN bool_or(sc.status='degraded') THEN 'degraded'
              ELSE 'up' END AS state,
         max(m.value) FILTER (WHERE m.metric='cpu_pct') AS maxcpu
  FROM synth_cmdb_service ss
  LEFT JOIN synth_cmdb_ci sc ON sc.service_id = ss.id
  LEFT JOIN synth_ci_metric_sample m ON m.ci_id = sc.id
  GROUP BY ss.id, ss.name
)
INSERT INTO cmdb_configuration_items
  (tenant_id, ci_external_id, ci_type, name, description, criticality_tier, source, attributes)
SELECT 'cfc5801f-db4e-454c-a14a-4732d9eac48a', roll.sid, 'banking_application', roll.sname,
       'SynthBank business service (synthetic)', 'unknown', 'canaris_ems',
       jsonb_build_object('golden_signal', jsonb_build_object(
         'availability_state', roll.state, 'cpu_saturation_pct', roll.maxcpu,
         'memory_saturation_pct', NULL, 'primary_saturation_pct', NULL,
         'primary_metric', NULL, 'latency_ms', NULL, 'packet_loss_pct', NULL,
         'last_reading_at', '2026-07-13T00:00:00.000Z'))
FROM roll
ON CONFLICT DO NOTHING;

INSERT INTO cmdb_service_ci_links (tenant_id, service_id, ci_id, role)
SELECT 'cfc5801f-db4e-454c-a14a-4732d9eac48a', bs.id, ci.id, 'primary'
FROM synth_cmdb_service ss
JOIN cmdb_business_services bs ON bs.name = ss.name AND bs.tenant_id='cfc5801f-db4e-454c-a14a-4732d9eac48a'
JOIN cmdb_configuration_items ci ON ci.ci_external_id = ss.id AND ci.tenant_id='cfc5801f-db4e-454c-a14a-4732d9eac48a'
ON CONFLICT DO NOTHING;

-- ── Service aliases as resolvable CI nodes ───────────────────────────────────
-- SynthBank ships a synonym→service alias table; the Copilot resolves synonyms
-- via its pack cmdb-mappings, not a DB alias table, so expose each alias as a CI
-- linked to its service. grounded-context then surfaces the canonical service name.
-- (Partial: an alias whose service name is NOT echoed in the narration — e.g. the
-- short "upi" vs "Mobile & UPI" — remains a documented finding, not force-fixed.)
WITH roll AS (
  SELECT ss.id AS sid, ss.name AS sname,
         CASE WHEN bool_or(sc.status='down') THEN 'down'
              WHEN bool_or(sc.status='degraded') THEN 'degraded' ELSE 'up' END AS state
  FROM synth_cmdb_service ss LEFT JOIN synth_cmdb_ci sc ON sc.service_id=ss.id
  GROUP BY ss.id, ss.name
)
INSERT INTO cmdb_configuration_items
  (tenant_id, ci_external_id, ci_type, name, description, criticality_tier, source, attributes)
SELECT 'cfc5801f-db4e-454c-a14a-4732d9eac48a', 'ALIAS:'||a.alias, 'banking_application', a.alias,
       'SynthBank service alias (synthetic)', 'unknown', 'canaris_ems',
       jsonb_build_object('golden_signal', jsonb_build_object(
         'availability_state', roll.state, 'cpu_saturation_pct', NULL,
         'memory_saturation_pct', NULL, 'primary_saturation_pct', NULL,
         'primary_metric', NULL, 'latency_ms', NULL, 'packet_loss_pct', NULL,
         'last_reading_at','2026-07-13T00:00:00.000Z'))
FROM synth_cmdb_service_aliases a JOIN roll ON roll.sid = a.service_id
ON CONFLICT DO NOTHING;

INSERT INTO cmdb_service_ci_links (tenant_id, service_id, ci_id, role)
SELECT 'cfc5801f-db4e-454c-a14a-4732d9eac48a', bs.id, ci.id, 'dependency'
FROM synth_cmdb_service_aliases a
JOIN synth_cmdb_service ss ON ss.id=a.service_id
JOIN cmdb_business_services bs ON bs.name=ss.name AND bs.tenant_id='cfc5801f-db4e-454c-a14a-4732d9eac48a'
JOIN cmdb_configuration_items ci ON ci.ci_external_id='ALIAS:'||a.alias AND ci.tenant_id='cfc5801f-db4e-454c-a14a-4732d9eac48a'
ON CONFLICT DO NOTHING;

-- ── Refresh the provider capability flags to match what we loaded ────────────
UPDATE tenant_data_sources
SET cmdb_capabilities = jsonb_build_object(
      'hasConfigurationItems', TRUE,
      'hasRelationshipGraph',  FALSE,
      'hasBusinessServices',   TRUE,
      'hasChangeLinkage',      FALSE,
      'hasOwnership',          FALSE,
      'hasCriticality',        FALSE,
      'hasGoldenSignals',      TRUE
    ),
    updated_at = now()
WHERE tenant_id = 'cfc5801f-db4e-454c-a14a-4732d9eac48a' AND provider_name = 'canaris_ems';

COMMIT;
