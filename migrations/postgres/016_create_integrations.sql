-- Reusable, connected notification integrations (Slack workspace, Discord
-- webhook, PagerDuty service, generic webhook). Secrets are stored encrypted
-- in `secret_enc` (AES-256-GCM); non-secret metadata lives in `config`.
-- SMTP is intentionally NOT modeled here — it stays in tenants.settings.

CREATE TABLE integrations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    kind        VARCHAR(32) NOT NULL,          -- slack | discord | pagerduty | webhook
    name        VARCHAR(255) NOT NULL,
    status      VARCHAR(32) NOT NULL DEFAULT 'active',  -- active | revoked | error
    config      JSONB NOT NULL DEFAULT '{}',   -- non-secret (team_id, channel_id, ...)
    secret_enc  BYTEA,                          -- versioned AES-GCM ciphertext
    created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_integrations_tenant ON integrations(tenant_id);

-- Prevent duplicate workspace/channel rows under concurrent connect flows;
-- OAuth callbacks upsert via ON CONFLICT on these expression indexes.
CREATE UNIQUE INDEX idx_integrations_slack_team
    ON integrations (tenant_id, (config ->> 'team_id'))
    WHERE kind = 'slack' AND config ? 'team_id';

CREATE UNIQUE INDEX idx_integrations_discord_channel
    ON integrations (tenant_id, (config ->> 'channel_id'))
    WHERE kind = 'discord' AND config ? 'channel_id';
