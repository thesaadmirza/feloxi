//! Stress tests for the engine crate.
//!
//! Run with: cargo test -p engine --test stress_tests -- --nocapture
//! Run ignored (slow) tests: cargo test -p engine --test stress_tests -- --ignored --nocapture

use std::time::Instant;

use common::{RawTaskEvent, RawWorkerEvent};
use engine::dag_resolver::{build_dag, DagNode};
use engine::event_processor::{normalize_task_event, normalize_worker_event};
use uuid::Uuid;

// ─── Helpers ──────────────────────────────────────────────────────────

fn make_dag_node(id: usize, group: Option<usize>) -> DagNode {
    DagNode {
        task_id: format!("task-{:06}", id),
        task_name: format!("app.tasks.process_{}", id % 50),
        state: match id % 4 {
            0 => "SUCCESS",
            1 => "FAILURE",
            2 => "STARTED",
            _ => "PENDING",
        }
        .to_string(),
        runtime: if id % 4 == 0 {
            Some(0.5 + (id % 100) as f64 * 0.01)
        } else {
            None
        },
        queue: format!("queue-{}", id % 4),
        worker_id: format!("celery@worker-{}", id % 8),
        group_id: group.map(|g| format!("group-{:04}", g)),
        parent_id: if id > 0 && id % 10 >= 3 {
            Some(format!("task-{:06}", id - 1))
        } else {
            None
        },
        chord_id: None,
    }
}

fn make_raw_task_event(index: usize) -> RawTaskEvent {
    RawTaskEvent {
        task_id: format!("task-{:06}", index),
        task_name: format!("app.tasks.process_item_{}", index % 20),
        event_type: match index % 5 {
            0 => "task-sent",
            1 => "task-received",
            2 => "task-started",
            3 => "task-succeeded",
            _ => "task-failed",
        }
        .to_string(),
        timestamp: 1700000000.0 + index as f64 * 0.001,
        queue: Some(format!("queue-{}", index % 4)),
        worker_id: Some(format!("celery@worker-{}", index % 8)),
        state: Some(
            match index % 5 {
                0 => "PENDING",
                1 => "RECEIVED",
                2 => "STARTED",
                3 => "SUCCESS",
                _ => "FAILURE",
            }
            .to_string(),
        ),
        args: Some(format!("[{}, {}]", index, index + 1)),
        kwargs: Some(format!("{{\"key\": \"value_{}\"}}", index)),
        result: if index % 5 == 3 {
            Some(format!("\"result_{}\"", index))
        } else {
            None
        },
        exception: if index % 5 == 4 {
            Some("ValueError: something went wrong".to_string())
        } else {
            None
        },
        traceback: if index % 5 == 4 {
            Some("Traceback (most recent call last):\n  File \"app.py\", line 42".to_string())
        } else {
            None
        },
        runtime: if index % 5 >= 3 {
            Some(0.1 + (index % 100) as f64 * 0.01)
        } else {
            None
        },
        retries: Some((index % 3) as u32),
        eta: None,
        expires: None,
        root_id: Some(format!("root-{:04}", index / 10)),
        parent_id: if index % 3 == 0 {
            Some(format!("task-{:06}", index.saturating_sub(1)))
        } else {
            None
        },
        group_id: if index % 7 == 0 {
            Some(format!("group-{:04}", index / 7))
        } else {
            None
        },
        chord_id: None,
    }
}

// ─── Test 1: DAG resolution at scale ──────────────────────────────────

#[test]
fn stress_dag_resolution_at_scale() {
    let dag_sizes = [1_000, 5_000, 10_000];

    println!("--- DAG Resolution at Scale ---");
    println!(
        "{:<12} {:>10} {:>10} {:>12} {:>12}",
        "Tasks", "Nodes", "Edges", "Build (ms)", "Tasks/ms"
    );
    println!("{}", "-".repeat(58));

    for &size in &dag_sizes {
        // Build a complex DAG with a mix of chain tasks and group tasks.
        // ~30% of tasks are in groups (groups of 5), the rest are chain tasks.
        let mut tasks = Vec::with_capacity(size);
        let mut group_counter = 0;

        for i in 0..size {
            let group = if i % 10 < 3 {
                // 30% of tasks in groups of 5
                let g = group_counter / 5;
                group_counter += 1;
                Some(g)
            } else {
                None
            };
            tasks.push(make_dag_node(i, group));
        }

        let start = Instant::now();
        let dag = build_dag(tasks);
        let elapsed = start.elapsed();

        println!(
            "{:<12} {:>10} {:>10} {:>11.2} {:>11.1}",
            size,
            dag.nodes.len(),
            dag.edges.len(),
            elapsed.as_secs_f64() * 1000.0,
            size as f64 / elapsed.as_secs_f64() / 1000.0,
        );

        // Verify the DAG was built correctly
        assert_eq!(dag.nodes.len(), size);
        assert!(!dag.root_id.is_empty());

        // Should have both chain and group edges
        let has_chain = dag
            .edges
            .iter()
            .any(|e| matches!(e.edge_type, engine::dag_resolver::EdgeType::Chain));
        let has_group = dag
            .edges
            .iter()
            .any(|e| matches!(e.edge_type, engine::dag_resolver::EdgeType::Group));

        // For sizes >= 1000, we expect both edge types
        assert!(has_chain, "Should have chain edges for size {}", size);
        assert!(has_group, "Should have group edges for size {}", size);
    }
}

// Ignored: the 10k DAG can be slow in debug mode due to O(n^2) group edges
// Run with --ignored to include this test.
#[test]
#[ignore]
fn stress_dag_resolution_50k_tasks() {
    // This test builds a very large DAG with 50,000 tasks.
    // Ignored because it may take >10s in debug builds due to O(n^2) group edge generation.
    let size = 50_000;
    let mut tasks = Vec::with_capacity(size);

    for i in 0..size {
        // Smaller groups to avoid quadratic blowup: groups of 3, only 10% in groups
        let group = if i % 10 == 0 {
            Some(i / 30)
        } else {
            None
        };
        tasks.push(make_dag_node(i, group));
    }

    let start = Instant::now();
    let dag = build_dag(tasks);
    let elapsed = start.elapsed();

    println!("--- DAG Resolution 50k ---");
    println!("Tasks: {}, Edges: {}, Time: {:?}", dag.nodes.len(), dag.edges.len(), elapsed);

    assert_eq!(dag.nodes.len(), size);
    assert!(
        elapsed.as_secs() < 60,
        "50k DAG took too long: {:?}",
        elapsed
    );
}

// ─── Test 2: Event normalization throughput ───────────────────────────

#[test]
fn stress_event_normalization_throughput() {
    let num_events = 100_000;
    let tenant_id = Uuid::new_v4();
    let agent_id = Uuid::new_v4();

    // Pre-build raw events
    let raw_events: Vec<RawTaskEvent> =
        (0..num_events).map(make_raw_task_event).collect();

    let start = Instant::now();
    let mut normalized_count = 0;

    for raw in &raw_events {
        let row = normalize_task_event(tenant_id, agent_id, "redis", raw);
        // Spot-check fields to prevent the compiler from optimizing away
        assert!(!row.task_id.is_empty());
        assert!(!row.state.is_empty());
        normalized_count += 1;
    }

    let elapsed = start.elapsed();
    let throughput = num_events as f64 / elapsed.as_secs_f64();

    println!("--- Event Normalization Throughput ---");
    println!("Events normalized: {}", normalized_count);
    println!("Total time:        {:?}", elapsed);
    println!("Throughput:        {:.0} events/sec", throughput);

    assert_eq!(normalized_count, num_events);

    // Verify some normalized events have correct state mapping
    let row_sent = normalize_task_event(tenant_id, agent_id, "redis", &raw_events[0]);
    assert_eq!(row_sent.state, "PENDING"); // task-sent -> PENDING

    let row_succeeded = normalize_task_event(tenant_id, agent_id, "redis", &raw_events[3]);
    assert_eq!(row_succeeded.state, "SUCCESS"); // task-succeeded -> SUCCESS

    // Should process at least 10k events/sec even in debug mode
    assert!(
        throughput > 10_000.0,
        "Normalization throughput too low: {:.0} events/sec",
        throughput
    );
}

#[test]
fn stress_worker_event_normalization_throughput() {
    let num_events = 100_000;
    let tenant_id = Uuid::new_v4();
    let agent_id = Uuid::new_v4();

    let raw_events: Vec<RawWorkerEvent> = (0..num_events)
        .map(|i| RawWorkerEvent {
            worker_id: format!("celery@worker-{}", i % 8),
            hostname: format!("worker-{}.local", i % 8),
            event_type: match i % 3 {
                0 => "worker-online",
                1 => "worker-heartbeat",
                _ => "worker-offline",
            }
            .to_string(),
            timestamp: 1700000000.0 + i as f64,
            active_tasks: Some((i % 10) as u32),
            processed: Some((i * 100) as u64),
            load_avg: Some(vec![1.0, 0.8, 0.5]),
            cpu_percent: Some(45.0 + (i % 50) as f64),
            memory_mb: Some(256.0),
            pool_size: Some(4),
            pool_type: Some("prefork".to_string()),
            sw_ident: Some("celery".to_string()),
            sw_ver: Some("5.3.0".to_string()),
        })
        .collect();

    let start = Instant::now();
    for raw in &raw_events {
        let row = normalize_worker_event(tenant_id, agent_id, raw);
        assert!(!row.worker_id.is_empty());
    }
    let elapsed = start.elapsed();

    let throughput = num_events as f64 / elapsed.as_secs_f64();
    println!("--- Worker Event Normalization Throughput ---");
    println!("Events:     {}", num_events);
    println!("Time:       {:?}", elapsed);
    println!("Throughput: {:.0} events/sec", throughput);

    assert!(
        throughput > 10_000.0,
        "Worker normalization throughput too low: {:.0} events/sec",
        throughput
    );
}
