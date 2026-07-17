-- SynthBank schema (SYNTHETIC ONLY).
-- Additive, namespaced with a synth_ prefix. Never touches product tables.
-- Load order: schema.sql, then seed.sql.

CREATE TABLE IF NOT EXISTS synth_cmdb_service (
    id    varchar PRIMARY KEY,
    name  varchar NOT NULL
);

CREATE TABLE IF NOT EXISTS synth_cmdb_service_aliases (
    alias       varchar NOT NULL,
    service_id  varchar NOT NULL REFERENCES synth_cmdb_service(id)
);

CREATE TABLE IF NOT EXISTS synth_cmdb_ci (
    id          varchar PRIMARY KEY,
    service_id  varchar NOT NULL REFERENCES synth_cmdb_service(id),
    kind        varchar NOT NULL,
    hostname    varchar,
    status      varchar            -- up | degraded | down
);

-- One row per metric that a CI is ACTUALLY reporting.
-- A metric that is genuinely absent has NO row here (not a zero row).
-- This is the honest-states contract at the data layer.
CREATE TABLE IF NOT EXISTS synth_ci_metric_sample (
    ci_id   varchar NOT NULL REFERENCES synth_cmdb_ci(id),
    metric  varchar NOT NULL,
    value   double precision NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_synth_metric_ci ON synth_ci_metric_sample(ci_id);
CREATE INDEX IF NOT EXISTS idx_synth_alias ON synth_cmdb_service_aliases(alias);
