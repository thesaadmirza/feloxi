-- Maintenance windows: suppress alert notifications without disabling rules.
-- rule_id NULL silences every rule in the tenant.
CREATE TABLE alert_silences (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    rule_id     UUID REFERENCES alert_rules(id) ON DELETE CASCADE,
    reason      TEXT,
    starts_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ends_at     TIMESTAMPTZ NOT NULL,
    created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_alert_silences_tenant ON alert_silences(tenant_id, ends_at DESC);

-- Optional per-rule severity override; NULL keeps the severity derived from
-- the condition type.
ALTER TABLE alert_rules ADD COLUMN severity_override VARCHAR(20);
