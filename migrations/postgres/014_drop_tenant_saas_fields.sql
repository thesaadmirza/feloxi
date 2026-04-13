-- Drop leftover SaaS-tier columns from the tenants table. Feloxi is a
-- self-hosted open-source tool; these fields were never enforced and only
-- showed up as confusing "Plan: free / Max Brokers: 2 / Max Events: 100K"
-- rows on the settings page.
ALTER TABLE tenants
    DROP COLUMN IF EXISTS plan,
    DROP COLUMN IF EXISTS max_agents,
    DROP COLUMN IF EXISTS max_events_day;
