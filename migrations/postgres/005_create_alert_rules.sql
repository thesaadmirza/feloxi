CREATE TABLE alert_rules (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    is_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
    condition       JSONB NOT NULL,
    channels        JSONB NOT NULL DEFAULT '[]',
    cooldown_secs   INT NOT NULL DEFAULT 300,
    last_fired_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_alert_rules_tenant ON alert_rules(tenant_id, is_enabled);

CREATE TABLE alert_history (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    rule_id         UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
    fired_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at     TIMESTAMPTZ,
    severity        VARCHAR(20) NOT NULL,
    summary         TEXT NOT NULL,
    details         JSONB NOT NULL DEFAULT '{}',
    channels_sent   JSONB NOT NULL DEFAULT '[]'
);
CREATE INDEX idx_alert_history_tenant ON alert_history(tenant_id, fired_at DESC);
