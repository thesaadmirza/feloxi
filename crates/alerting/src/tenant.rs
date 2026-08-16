use serde::Serialize;
use uuid::Uuid;

use db::postgres::models::Tenant;

/// The tenant an alert belongs to, rendered into every outbound notification.
///
/// One Slack channel, inbox, or webhook endpoint can receive alerts from
/// several tenants of the same Feloxi instance; without this there is nothing
/// in the payload to attribute them to a source.
///
/// Built at dispatch from the tenant row that owns the rule rather than stored
/// on [`crate::engine::FiredAlert`], which is serialized into the delivery
/// retry queue — keeping it out of that payload means no caller can construct
/// an unattributed alert and a retry never renders a stale name.
#[derive(Debug, Clone, Serialize)]
pub struct AlertTenant {
    pub id: Uuid,
    /// Display name, e.g. `Acme Payments`.
    pub name: String,
    /// Stable machine key. Route on this — the display name is a label.
    pub slug: String,
}

impl From<&Tenant> for AlertTenant {
    fn from(tenant: &Tenant) -> Self {
        Self { id: tenant.id, name: tenant.name.clone(), slug: tenant.slug.clone() }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_to_the_documented_webhook_shape() {
        let tenant = AlertTenant {
            id: Uuid::nil(),
            name: "Acme Payments".into(),
            slug: "acme-payments".into(),
        };
        let json = serde_json::to_value(&tenant).unwrap();
        assert_eq!(json["id"], "00000000-0000-0000-0000-000000000000");
        assert_eq!(json["name"], "Acme Payments");
        assert_eq!(json["slug"], "acme-payments");
    }
}
