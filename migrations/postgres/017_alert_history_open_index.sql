-- Open (unresolved) alerts are looked up per tenant on every evaluation pass.
CREATE INDEX idx_alert_history_open ON alert_history(tenant_id, rule_id)
    WHERE resolved_at IS NULL;
