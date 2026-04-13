CREATE TABLE user_invites (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email           VARCHAR(255) NOT NULL,
    role_name       VARCHAR(64) NOT NULL,
    token_hash      VARCHAR(64) NOT NULL UNIQUE,
    invited_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    expires_at      TIMESTAMPTZ NOT NULL,
    accepted_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_user_invites_tenant_email_pending
    ON user_invites(tenant_id, email)
    WHERE accepted_at IS NULL;

CREATE INDEX idx_user_invites_token_hash ON user_invites(token_hash);
