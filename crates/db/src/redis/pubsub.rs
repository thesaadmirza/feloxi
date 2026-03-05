use fred::prelude::*;
use serde::Serialize;
use uuid::Uuid;

use super::keys;

/// Publish an event to the tenant's event channel.
pub async fn publish_event(
    pool: &Pool,
    tenant_id: Uuid,
    event: &impl Serialize,
) -> Result<(), Error> {
    let channel = keys::pubsub_events(tenant_id);
    let json = serde_json::to_string(event).map_err(|e| {
        Error::new(ErrorKind::Parse, e.to_string())
    })?;
    let client = pool.next();
    let _: i64 = client.publish(&channel, json.as_str()).await?;
    Ok(())
}

/// Publish an alert notification.
pub async fn publish_alert(
    pool: &Pool,
    tenant_id: Uuid,
    alert: &impl Serialize,
) -> Result<(), Error> {
    let channel = keys::pubsub_alerts(tenant_id);
    let json = serde_json::to_string(alert).map_err(|e| {
        Error::new(ErrorKind::Parse, e.to_string())
    })?;
    let client = pool.next();
    let _: i64 = client.publish(&channel, json.as_str()).await?;
    Ok(())
}
