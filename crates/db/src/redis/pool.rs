use fred::prelude::*;

/// Default pool size. Override with `FP_REDIS_POOL_SIZE`.
const DEFAULT_POOL_SIZE: usize = 50;

pub async fn create_redis_pool(url: &str) -> Result<Pool, Error> {
    let pool_size = std::env::var("FP_REDIS_POOL_SIZE")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(DEFAULT_POOL_SIZE);

    let config = Config::from_url(url)?;
    let mut builder = Builder::from_config(config);
    builder.set_policy(ReconnectPolicy::new_exponential(0, 100, 30_000, 2));

    let pool = builder.build_pool(pool_size)?;
    pool.init().await?;
    Ok(pool)
}
