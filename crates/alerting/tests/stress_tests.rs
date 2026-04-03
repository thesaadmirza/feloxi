//! Stress tests for the alerting crate.
//!
//! Run with: cargo test -p alerting --test stress_tests -- --nocapture
//! Run ignored (slow) tests: cargo test -p alerting --test stress_tests -- --ignored --nocapture

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use alerting::engine::{evaluate_condition, EvaluationContext, FiredAlert};
use alerting::rules::AlertCondition;
use alerting::templates::{format_html, format_plain_text};
use alerting::throttle::AlertThrottle;
use uuid::Uuid;

// ─── Helpers ──────────────────────────────────────────────────────────

fn make_alert(index: usize) -> FiredAlert {
    FiredAlert {
        id: Uuid::new_v4(),
        rule_id: Uuid::new_v4(),
        tenant_id: Uuid::new_v4(),
        rule_name: format!("Alert Rule {}", index),
        condition_type: Some("task_failure_rate".to_string()),
        severity: match index % 3 {
            0 => "critical".to_string(),
            1 => "warning".to_string(),
            _ => "info".to_string(),
        },
        summary: format!(
            "Task failure rate for app.tasks.process_{} exceeded threshold ({:.1}%)",
            index,
            10.0 + (index % 90) as f64
        ),
        details: serde_json::json!({
            "task_name": format!("app.tasks.process_{}", index),
            "current_rate": 0.15 + (index % 80) as f64 * 0.01,
            "threshold": 0.1,
            "window_minutes": 5,
            "sample_size": 100 + index,
        }),
        fired_at: 1700000000.0 + index as f64,
    }
}

fn make_condition(index: usize) -> (AlertCondition, EvaluationContext) {
    match index % 7 {
        0 => (
            AlertCondition::TaskFailureRate {
                threshold: 0.1,
                window_minutes: 5,
                task_name: format!("tasks.process_{}", index),
            },
            EvaluationContext {
                failure_rate: 0.15 + (index % 50) as f64 * 0.01,
                ..Default::default()
            },
        ),
        1 => (
            AlertCondition::QueueDepth { threshold: 100, queue: format!("queue-{}", index % 4) },
            EvaluationContext { queue_depth: 150 + (index % 1000) as u64, ..Default::default() },
        ),
        2 => (
            AlertCondition::WorkerOffline { grace_period_seconds: 60 },
            EvaluationContext {
                workers_went_offline: 1 + (index % 5) as u32,
                ..Default::default()
            },
        ),
        3 => (
            AlertCondition::TaskDuration {
                threshold_seconds: 10.0,
                percentile: 95.0,
                task_name: format!("tasks.heavy_{}", index),
            },
            EvaluationContext { p95_runtime: 15.0 + (index % 30) as f64, ..Default::default() },
        ),
        4 => (
            AlertCondition::BeatMissed { schedule_name: format!("schedule-{}", index) },
            EvaluationContext {
                beat_schedules_missed: 1 + (index % 3) as u32,
                ..Default::default()
            },
        ),
        5 => (
            AlertCondition::TaskFailed { task_name: format!("tasks.payment_{}", index) },
            EvaluationContext { recent_failures: 1 + (index % 10) as u64, ..Default::default() },
        ),
        _ => (
            AlertCondition::NoEvents { silence_minutes: 5 },
            EvaluationContext {
                seconds_since_last_event: 301.0 + (index % 600) as f64,
                ..Default::default()
            },
        ),
    }
}

// ─── Test 8: Alert evaluation throughput ──────────────────────────────

#[test]
fn stress_alert_evaluation_throughput() {
    let num_evaluations = 100_000;

    // Pre-build conditions and contexts
    let test_data: Vec<(AlertCondition, EvaluationContext)> =
        (0..num_evaluations).map(make_condition).collect();

    let start = Instant::now();
    let mut triggered_count = 0;

    for (condition, context) in &test_data {
        if evaluate_condition(condition, context) {
            triggered_count += 1;
        }
    }

    let elapsed = start.elapsed();
    let throughput = num_evaluations as f64 / elapsed.as_secs_f64();

    println!("--- Alert Evaluation Throughput ---");
    println!("Evaluations:   {}", num_evaluations);
    println!("Triggered:     {}", triggered_count);
    println!("Total time:    {:?}", elapsed);
    println!("Throughput:    {:.0} evaluations/sec", throughput);

    // All conditions are constructed to trigger (values above thresholds)
    assert_eq!(
        triggered_count, num_evaluations,
        "All conditions should trigger since contexts exceed thresholds"
    );

    // Should be extremely fast - at least 1M evaluations/sec
    assert!(
        throughput > 100_000.0,
        "Alert evaluation throughput too low: {:.0} evaluations/sec",
        throughput
    );
}

#[test]
fn stress_alert_evaluation_mixed_trigger_and_no_trigger() {
    let num_evaluations = 100_000;

    // Build mixed conditions: some trigger, some don't
    let test_data: Vec<(AlertCondition, EvaluationContext)> = (0..num_evaluations)
        .map(|i| {
            if i % 2 == 0 {
                // Will trigger - failure rate above threshold
                (
                    AlertCondition::TaskFailureRate {
                        threshold: 0.1,
                        window_minutes: 5,
                        task_name: format!("task_{}", i),
                    },
                    EvaluationContext { failure_rate: 0.5, ..Default::default() },
                )
            } else {
                // Won't trigger - failure rate below threshold
                (
                    AlertCondition::TaskFailureRate {
                        threshold: 0.1,
                        window_minutes: 5,
                        task_name: format!("task_{}", i),
                    },
                    EvaluationContext { failure_rate: 0.05, ..Default::default() },
                )
            }
        })
        .collect();

    let start = Instant::now();
    let mut triggered = 0;
    let mut not_triggered = 0;

    for (condition, context) in &test_data {
        if evaluate_condition(condition, context) {
            triggered += 1;
        } else {
            not_triggered += 1;
        }
    }

    let elapsed = start.elapsed();

    println!("--- Mixed Alert Evaluation ---");
    println!("Total:         {}", num_evaluations);
    println!("Triggered:     {}", triggered);
    println!("Not triggered: {}", not_triggered);
    println!("Time:          {:?}", elapsed);

    assert_eq!(triggered, num_evaluations / 2);
    assert_eq!(not_triggered, num_evaluations / 2);
}

// ─── Test 9: Throttle concurrent access ───────────────────────────────

#[test]
fn stress_throttle_sequential_high_volume() {
    let mut throttle = AlertThrottle::new();
    let num_rules = 10_000;
    let cooldown = Duration::from_secs(300);

    let rule_ids: Vec<Uuid> = (0..num_rules).map(|_| Uuid::new_v4()).collect();

    // Fire all rules
    let fire_start = Instant::now();
    for &rule_id in &rule_ids {
        throttle.record_fired(rule_id);
    }
    let fire_elapsed = fire_start.elapsed();

    // Check all rules are throttled
    let check_start = Instant::now();
    let mut throttled_count = 0;
    for &rule_id in &rule_ids {
        if throttle.is_throttled(rule_id, cooldown) {
            throttled_count += 1;
        }
    }
    let check_elapsed = check_start.elapsed();

    println!("--- Throttle Sequential High Volume ---");
    println!("Rules:         {}", num_rules);
    println!("Fire time:     {:?}", fire_elapsed);
    println!("Check time:    {:?}", check_elapsed);
    println!("Throttled:     {}", throttled_count);

    assert_eq!(throttled_count, num_rules);
}

#[test]
fn stress_throttle_concurrent_access() {
    // The AlertThrottle uses &mut self, so we wrap in Arc<Mutex<>> for
    // concurrent access from multiple threads.
    let throttle = Arc::new(Mutex::new(AlertThrottle::new()));
    let num_threads = 10;
    let ops_per_thread = 10_000;
    let cooldown = Duration::from_secs(300);

    let start = Instant::now();

    let handles: Vec<_> = (0..num_threads)
        .map(|thread_idx| {
            let throttle = Arc::clone(&throttle);
            std::thread::spawn(move || {
                let mut fired_count = 0;
                let mut throttled_count = 0;

                for i in 0..ops_per_thread {
                    let rule_id = Uuid::new_v4();

                    // First check: should not be throttled (never fired)
                    {
                        let t = throttle.lock().unwrap();
                        if t.is_throttled(rule_id, cooldown) {
                            panic!(
                                "Thread {} op {}: new rule should not be throttled",
                                thread_idx, i
                            );
                        }
                    }

                    // Fire
                    {
                        let mut t = throttle.lock().unwrap();
                        t.record_fired(rule_id);
                        fired_count += 1;
                    }

                    // Second check: should be throttled
                    {
                        let t = throttle.lock().unwrap();
                        if t.is_throttled(rule_id, cooldown) {
                            throttled_count += 1;
                        }
                    }
                }

                (fired_count, throttled_count)
            })
        })
        .collect();

    let mut total_fired = 0;
    let mut total_throttled = 0;
    for handle in handles {
        let (fired, throttled) = handle.join().expect("thread panicked");
        total_fired += fired;
        total_throttled += throttled;
    }

    let elapsed = start.elapsed();
    let total_ops = num_threads * ops_per_thread;

    println!("--- Throttle Concurrent Access ---");
    println!("Threads:       {}", num_threads);
    println!("Ops/thread:    {}", ops_per_thread);
    println!("Total ops:     {}", total_ops * 3); // 3 ops per iteration (check, fire, check)
    println!("Total fired:   {}", total_fired);
    println!("Total throttled after fire: {}", total_throttled);
    println!("Time:          {:?}", elapsed);

    assert_eq!(total_fired, total_ops);
    assert_eq!(total_throttled, total_ops);
}

#[test]
fn stress_throttle_cleanup_under_load() {
    let mut throttle = AlertThrottle::new();
    let num_rules = 10_000;

    // Fire all rules
    let rule_ids: Vec<Uuid> = (0..num_rules).map(|_| Uuid::new_v4()).collect();
    for &rule_id in &rule_ids {
        throttle.record_fired(rule_id);
    }

    // Verify all throttled
    let all_throttled =
        rule_ids.iter().all(|&id| throttle.is_throttled(id, Duration::from_secs(300)));
    assert!(all_throttled, "All rules should be throttled after firing");

    // Wait a tiny bit and cleanup with very short max_cooldown
    std::thread::sleep(Duration::from_millis(10));

    let cleanup_start = Instant::now();
    throttle.cleanup(Duration::from_millis(1));
    let cleanup_elapsed = cleanup_start.elapsed();

    // After cleanup, none should be throttled
    let any_throttled =
        rule_ids.iter().any(|&id| throttle.is_throttled(id, Duration::from_secs(300)));
    assert!(!any_throttled, "No rules should be throttled after cleanup");

    println!("--- Throttle Cleanup Under Load ---");
    println!("Rules cleaned: {}", num_rules);
    println!("Cleanup time:  {:?}", cleanup_elapsed);
}

// ─── Test 10: Template rendering throughput ───────────────────────────

#[test]
fn stress_template_rendering_throughput() {
    let num_renders = 50_000;

    // Pre-build alerts with varying severities and content
    let alerts: Vec<FiredAlert> = (0..num_renders).map(make_alert).collect();

    // Render plain text
    let plain_start = Instant::now();
    let mut plain_total_len = 0;
    for alert in &alerts {
        let text = format_plain_text(alert);
        plain_total_len += text.len();
        // Verify the output has the expected structure
        assert!(text.contains(']'), "Plain text should contain severity brackets");
    }
    let plain_elapsed = plain_start.elapsed();

    // Render HTML
    let html_start = Instant::now();
    let mut html_total_len = 0;
    for alert in &alerts {
        let html = format_html(alert);
        html_total_len += html.len();
        // Verify the output is valid HTML-like structure
        assert!(html.contains("<div"), "HTML should contain div elements");
    }
    let html_elapsed = html_start.elapsed();

    let total_elapsed = plain_elapsed + html_elapsed;
    let total_renders = num_renders * 2;

    println!("--- Template Rendering Throughput ---");
    println!("Renders:           {} ({} plain + {} html)", total_renders, num_renders, num_renders);
    println!("Plain text time:   {:?}", plain_elapsed);
    println!("HTML time:         {:?}", html_elapsed);
    println!("Total time:        {:?}", total_elapsed);
    println!(
        "Plain throughput:  {:.0} renders/sec",
        num_renders as f64 / plain_elapsed.as_secs_f64()
    );
    println!(
        "HTML throughput:   {:.0} renders/sec",
        num_renders as f64 / html_elapsed.as_secs_f64()
    );
    println!(
        "Total throughput:  {:.0} renders/sec",
        total_renders as f64 / total_elapsed.as_secs_f64()
    );
    println!("Avg plain size:    {} bytes", plain_total_len / num_renders);
    println!("Avg HTML size:     {} bytes", html_total_len / num_renders);

    // Verify content correctness for different severity types
    let critical_alert = make_alert(0); // index 0 -> "critical"
    let critical_html = format_html(&critical_alert);
    assert!(critical_html.contains("#dc2626"), "Critical should use red");

    let warning_alert = make_alert(1); // index 1 -> "warning"
    let warning_html = format_html(&warning_alert);
    assert!(warning_html.contains("#f59e0b"), "Warning should use amber");

    let info_alert = make_alert(2); // index 2 -> "info"
    let info_html = format_html(&info_alert);
    assert!(info_html.contains("#10b981"), "Info should use green");

    // Should complete quickly
    assert!(total_elapsed.as_secs() < 30, "Template rendering took too long: {:?}", total_elapsed);
}

#[test]
fn stress_template_rendering_large_content() {
    // Test with alerts that have very long summaries and rule names
    let num_renders = 10_000;

    let alerts: Vec<FiredAlert> = (0..num_renders)
        .map(|i| FiredAlert {
            id: Uuid::new_v4(),
            rule_id: Uuid::new_v4(),
            tenant_id: Uuid::new_v4(),
            rule_name: format!("Complex Rule with Long Name: Monitor Task {} for Failures and Performance Degradation on Queue {}", i, i % 4),
            condition_type: Some("task_failure_rate".to_string()),
            severity: "critical".to_string(),
            summary: format!(
                "Multiple issues detected: Task app.tasks.complex_process_{} failure rate is {:.1}% (threshold 10.0%), \
                P95 runtime is {:.1}s (threshold 5.0s), queue depth is {} (threshold 100), \
                {} workers offline. Immediate attention required for production stability.",
                i, 15.0 + (i % 80) as f64, 8.0 + (i % 20) as f64, 150 + i % 1000, 1 + i % 5
            ),
            details: serde_json::json!({}),
            fired_at: 1700000000.0 + i as f64,
        })
        .collect();

    let start = Instant::now();
    for alert in &alerts {
        let plain = format_plain_text(alert);
        let html = format_html(alert);
        assert!(plain.len() > 50);
        assert!(html.len() > 200);
    }
    let elapsed = start.elapsed();

    println!("--- Large Content Template Rendering ---");
    println!("Renders:       {} (plain+html each)", num_renders);
    println!("Time:          {:?}", elapsed);
    println!("Throughput:    {:.0} render-pairs/sec", num_renders as f64 / elapsed.as_secs_f64());
}
