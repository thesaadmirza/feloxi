use chrono::{DateTime, Utc};

/// Get current UTC timestamp.
pub fn now() -> DateTime<Utc> {
    Utc::now()
}

/// Convert a Unix timestamp (seconds with fractional ms) to DateTime.
pub fn from_unix_f64(ts: f64) -> DateTime<Utc> {
    let secs = ts as i64;
    let nanos = ((ts - secs as f64) * 1_000_000_000.0) as u32;
    DateTime::from_timestamp(secs, nanos).unwrap_or_else(Utc::now)
}

/// Convert DateTime to Unix timestamp (seconds with fractional ms).
pub fn to_unix_f64(dt: &DateTime<Utc>) -> f64 {
    dt.timestamp() as f64 + dt.timestamp_subsec_nanos() as f64 / 1_000_000_000.0
}

/// Format a duration in seconds to a human-readable string.
pub fn format_duration_secs(secs: f64) -> String {
    if secs < 0.001 {
        format!("{:.0}μs", secs * 1_000_000.0)
    } else if secs < 1.0 {
        format!("{:.1}ms", secs * 1000.0)
    } else if secs < 60.0 {
        format!("{:.2}s", secs)
    } else if secs < 3600.0 {
        let mins = (secs / 60.0).floor();
        let remaining = secs - mins * 60.0;
        format!("{:.0}m {:.0}s", mins, remaining)
    } else {
        let hours = (secs / 3600.0).floor();
        let remaining = secs - hours * 3600.0;
        let mins = (remaining / 60.0).floor();
        format!("{:.0}h {:.0}m", hours, mins)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unix_f64_roundtrip() {
        for &val in &[0.0, 1.0, 1000.0, 1704067200.0, 1704067200.5] {
            let dt = from_unix_f64(val);
            let back = to_unix_f64(&dt);
            assert!((back - val).abs() < 0.01, "roundtrip failed for {val}: got {back}");
        }
        // now() roundtrip
        let n = now();
        assert!((Utc::now() - n).num_seconds().abs() < 1);
    }

    #[test]
    fn format_duration_all_ranges() {
        let cases = [
            (0.0, "0μs"),
            (0.0001, "100μs"),
            (0.001, "1.0ms"),
            (0.5, "500.0ms"),
            (0.999, "999.0ms"),
            (1.0, "1.00s"),
            (5.123, "5.12s"),
            (59.99, "59.99s"),
            (60.0, "1m 0s"),
            (125.0, "2m 5s"),
            (3600.0, "1h 0m"),
            (3725.0, "1h 2m"),
            (86400.0, "24h 0m"),
        ];
        for (input, expected) in &cases {
            assert_eq!(format_duration_secs(*input), *expected, "input={input}");
        }
    }
}
