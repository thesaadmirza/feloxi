use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;

pub async fn create_pg_pool(database_url: &str) -> Result<PgPool, sqlx::Error> {
    let max_connections: u32 =
        std::env::var("FP_PG_MAX_CONNECTIONS").ok().and_then(|v| v.parse().ok()).unwrap_or(50);

    PgPoolOptions::new()
        .max_connections(max_connections)
        .min_connections(2)
        .acquire_timeout(std::time::Duration::from_secs(10))
        .connect(database_url)
        .await
}

pub async fn run_migrations(pool: &PgPool) -> Result<(), sqlx::migrate::MigrateError> {
    sqlx::migrate!("../../migrations/postgres").run(pool).await
}
