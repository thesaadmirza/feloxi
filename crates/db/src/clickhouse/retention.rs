use clickhouse::Client;

/// Apply a TTL policy to a ClickHouse table by executing ALTER TABLE ... MODIFY TTL.
pub async fn apply_table_ttl(
    client: &Client,
    table: &str,
    retention_days: u32,
) -> Result<(), String> {
    let sql = format!(
        "ALTER TABLE {table} MODIFY TTL toDateTime(timestamp) + INTERVAL {retention_days} DAY"
    );
    client.query(&sql).execute().await.map_err(|e| format!("ClickHouse TTL error on {table}: {e}"))
}
