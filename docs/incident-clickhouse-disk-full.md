# Incident Postmortem & Hardening: ClickHouse Disk-Full → Event Loss

> **TL;DR** — When ClickHouse ran out of disk in production, inserts failed,
> the Redis retry buffer silently evicted the overflow, and the System Health
> "Lost" counter still read **0**. We were blind to the loss, and tasks whose
> terminal events were dropped were left stuck in `STARTED`/`PENDING` forever.
> This document reproduces the failure with the real code, explains the root
> causes, summarizes the industry-standard fix, and records what we changed.

---

## 1. What happened

| | |
|---|---|
| **Trigger** | ClickHouse `default` disk reached 100%. |
| **Immediate effect** | `INSERT`s into `task_events` / `worker_events` failed. New events stopped landing. |
| **Why we were blind** | The retry buffer (Redis list, hard-capped at 2,000 batches) silently dropped the overflow via `LTRIM`, and **`events_dropped` was only incremented when the Redis push itself failed** — never on overflow eviction. The "Lost" metric stayed at 0. |
| **Why old in-flight tasks were wrong** | Task state is reconstructed at read time with `argMax(field, timestamp)`. If the disk-full window dropped a task's terminal `SUCCESS`/`FAILURE` event while keeping its earlier `RECEIVED`/`STARTED`, the merged record is permanently stuck in a non-terminal state with no result/runtime. Nothing reconciles it. |
| **Why recovery was hard** | A 100%-full ClickHouse can't run the merges/mutations needed to free space (they need scratch space first), so the only safe escape is `DROP PARTITION`. |

---

## 2. Reproduction (real code, deterministic)

The Docker registry is blocked in our sandbox, so instead of spinning up a
disk-limited ClickHouse container we drive the **actual resilience code**
(`db::redis::cache::push_retry_batch` / `pop_retry_batches` / the pipeline
counters — the same functions `crates/api/src/broker_conn/pipeline.rs` calls in
production) against a local Redis.

```
crates/db/tests/clickhouse_disk_full_incident.rs
```

Run it:

```bash
redis-server --port 6399 --save '' --appendonly no --daemonize yes
REDIS_TEST_URL="redis://127.0.0.1:6399/15" \
  cargo test -p db --test clickhouse_disk_full_incident -- --nocapture
```

**Before the fix**, the test demonstrated the incident exactly:

```
──────── ClickHouse disk-full incident reproduction ────────
Events received during outage : 500000
Buffer cap (batches)          : 2000
Events that survived          : 200000
Events ACTUALLY lost          : 300000
Events the UI REPORTS as lost : 0        <-- operator is blind
────────────────────────────────────────────────────────────
```

And the in-flight inaccuracy:

```
Healthy merge : state=SUCCESS, result={"ok":true}, runtime=12.5
Lossy merge   : state=STARTED, result="",          runtime=0   <-- stuck forever
```

**After the fix**, the reported loss equals the real loss (the test now asserts
this as a regression guard):

```
Events ACTUALLY lost          : 300000
Events the UI REPORTS as lost : 300000   <-- accurate
```

---

## 3. Root-cause inventory

A full code-path audit (every place an event can be silently lost) found:

1. **Silent overflow eviction** — `cache::push_retry_batch` did `LPUSH` + `LTRIM 0 1999`; the trimmed (oldest) batches vanished uncounted. *(cardinal bug)*
2. **No disk-pressure alert** — 10 alert conditions existed; none watched ClickHouse disk. The disk filled with no page.
3. **No server-side insert guard** — ClickHouse had no `min_free_disk_ratio_to_perform_insert` / `keep_free_space_bytes`, so it ran to 100% (the unrecoverable state) instead of rejecting inserts cleanly with headroom left.
4. **Time-only retention** — retention is a fixed 90-day TTL run hourly; it is not triggered by disk pressure and can't help once the disk is full (TTL deletes need merges, which need space).
5. **No reconciliation** — tasks stuck in a non-terminal state after partial event loss are never swept or marked.
6. **Readiness masks the failure** — `readyz` pings `SELECT 1`, which succeeds even when the disk is full, so the pod stays "Ready" while writes fail.

---

## 4. Industry standard (and why)

Researched against ClickHouse docs/issues, Altinity, Vector, OpenTelemetry
Collector, Kafka Connect, Kinesis Firehose, and the Google SRE book. The
consensus hierarchy when a sink is unavailable:

> **Backpressure first → durable disk-backed buffer second → bounded drop only as a last resort, and *never silently*.**

- **Never drop silently.** Every mature pipeline makes loss a first-class,
  *counted, alertable* event (OTel `exporter_enqueue_failed_*`, Kafka Connect
  DLQ, Firehose S3-backup). This maps to the SRE **"saturation"** golden signal
  — page when a signal is problematic *or, for saturation, nearly* so.
- **A non-durable source needs a durable buffer.** Celery's broker events are
  fire-and-forget pub/sub — they can't be replayed or back-pressured. The
  canonical fix is to put a **durable queue/WAL between consumer and sink**
  (Vector disk buffers, OTel `file_storage`, Kafka). Our Redis-list buffer is a
  degenerate, non-durable, silently-lossy version of that.
- **Guard the disk before 100%.** ClickHouse `min_free_disk_ratio_to_perform_insert`
  (24.10+) rejects inserts cleanly with `NOT_ENOUGH_SPACE` while headroom
  remains, keeping space for `DROP PARTITION`/merges. Alert at **80/90%** *and*
  with predictive `predict_linear` "full in N hours".
- **Make records correct under partial loss.** Idempotent upserts
  (`ReplacingMergeTree(version)` + `insert_deduplication_token`) make WAL replay
  safe; a **reconciliation sweep** marks stale non-terminal rows `UNKNOWN/LOST`
  so inaccuracy is explicit, not silent.

**The "if you can only do 5 things" list:** (1) stop dropping silently — count
& alert; (2) put a durable WAL between pub/sub and ClickHouse; (3) add the
ClickHouse insert disk-guard + cap system logs; (4) alert on disk capacity
(static + predictive); (5) idempotent upserts + reconciliation sweep.

---

## 5. What we changed (the "after" state)

### Backend

| Change | File |
|---|---|
| `push_retry_batch` now **explicitly evicts and counts** overflow, returning the exact number of events dropped (replaces silent `LTRIM`). | `crates/db/src/redis/cache.rs` |
| Ingest path **increments `events_dropped`** by that count and logs an `error` — the "Lost" metric is now accurate. | `crates/api/src/broker_conn/pipeline.rs` |
| New **`retry_queue_depth`** gauge → surfaced as `retry_buffer_depth` / `retry_buffer_capacity` in the system health/pipeline API. | `crates/db/src/redis/cache.rs`, `crates/api/src/routes/system.rs` |
| New alert condition **`StoragePressure { threshold_percent }`**, evaluated against ClickHouse disk usage each cycle. | `crates/db/src/postgres/models.rs`, `crates/alerting/src/engine.rs`, `crates/api/src/main.rs` |
| Regression test reproducing the incident **and** asserting the fix. | `crates/db/tests/clickhouse_disk_full_incident.rs` |

### Infra

| Change | File |
|---|---|
| ClickHouse **insert disk-guard** (`min_free_disk_ratio_to_perform_insert = 0.05`) + bounded merge scratch (`max_bytes_to_merge_at_max_space_in_pool`). Turns "100% full = unrecoverable" into "clean retryable error with 5% headroom for `DROP PARTITION`". | `deploy/docker/clickhouse-config.xml`, `deploy/k8s/11-clickhouse.yaml`, `charts/feloxi/templates/clickhouse-configmap.yaml` |
| Helm value `clickhouse.minFreeDiskRatioToInsert` (default `0.05`). | `charts/feloxi/values.yaml` |
| (Pre-existing, retained) system-log-table TTL caps to stop CH internal logs from filling the disk. | same files |

### UI

| Change | File |
|---|---|
| **Retry-buffer saturation bar** on the System Health page (green/amber/red) — the early warning that ingestion is stalling before any loss. | `apps/web/src/app/(dashboard)/system/page.tsx` |
| "Lost" card turns **red** when non-zero and is relabeled to reflect it now counts buffer-overflow drops. | same |
| **Storage Pressure** alert type added to the alert-rule builder (threshold %, recommend 80–85%). | `apps/web/src/app/(dashboard)/alerts/page.tsx` |
| `openapi.json` + generated TS types regenerated. | `apps/web/openapi.json`, `apps/web/src/lib/api/v1.d.ts` |

### Incident flow — before vs after

```
BEFORE
  CH disk → 100%  →  INSERT fails  →  Redis buffer fills  →  LTRIM drops oldest
                                                              (uncounted, no alert)
  UI: "Lost: 0", status "healthy"   →  operator blind  →  tasks stuck STARTED forever

AFTER
  CH disk → 80%   →  StoragePressure alert fires (Slack/PagerDuty)   ┐ time to act
  CH disk → 95%   →  insert guard rejects cleanly, 5% headroom kept  ┘ (DROP PARTITION works)
  Buffer filling  →  saturation bar amber/red on System page
  Overflow drop   →  events_dropped is accurate, "Lost" card red, drop logged at error
  Recovery        →  buffered batches replay automatically once space is freed
```

---

## 6. Recommended next steps (not yet implemented)

These are the larger, higher-effort items from the research worth scheduling:

1. **Durable WAL between the broker consumer and ClickHouse** (Redis Streams +
   AOF, or Kafka, or a local disk WAL). This is *the* structural fix — it makes
   a ClickHouse outage cost zero events as long as the WAL has room. The current
   Redis-list buffer should be sized by *hours of outage to survive*, made
   persistent (AOF), not a magic 2,000.
2. **Idempotent upserts**: model tasks as `ReplacingMergeTree(version)` keyed by
   `task_id`, add `insert_deduplication_token` per batch, so WAL replay is safe.
3. **Reconciliation sweep**: a periodic job that marks non-terminal tasks older
   than a max-runtime threshold as `UNKNOWN/LOST`, so partial loss is explicit.
4. **Predictive capacity alerting** (`predict_linear` "disk full in N hours") and
   a tested **`DROP PARTITION` emergency runbook**; consider tiered storage
   (hot local → cold S3 via `TTL ... TO VOLUME`).
5. **Readiness that reflects write capability**, so a write-blocked node is
   visibly degraded rather than silently "Ready".
```
