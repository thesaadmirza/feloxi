#!/usr/bin/env python3
"""
Feloxi Demo Data Seeder
Seeds PostgreSQL, ClickHouse, and Redis with realistic demo data.
Runs automatically on first `docker compose up` when FELOXI_SEED_DEMO=true.
Idempotent: skips seeding if demo tenant already exists.
"""

import json
import os
import random
import subprocess
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from urllib.error import URLError
from urllib.request import Request, urlopen

try:
    from argon2 import PasswordHasher
    _hasher = PasswordHasher(memory_cost=19456, time_cost=2, parallelism=1)
    def hash_password(password: str) -> str:
        return _hasher.hash(password)
except ImportError:
    # Fallback: pre-computed hash (only works for "password123")
    def hash_password(password: str) -> str:
        raise RuntimeError("argon2-cffi not installed — cannot hash passwords")

# ── Config ─────────────────────────────────────────────────
PG_HOST = os.getenv("PG_HOST", "localhost")
PG_PORT = os.getenv("PG_PORT", "5432")
PG_USER = os.getenv("PG_USER", "fp")
PG_PASS = os.getenv("PG_PASS", "feloxi")
PG_DB = os.getenv("PG_DB", "feloxi")

CH_HOST = os.getenv("CH_HOST", "localhost")
CH_PORT = os.getenv("CH_PORT", "8123")
CH_USER = os.getenv("CH_USER", "")
CH_PASSWORD = os.getenv("CH_PASSWORD", "")

REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
REDIS_PORT = os.getenv("REDIS_PORT", "6379")

# ── Demo Data ──────────────────────────────────────────────
DEMO_TENANT_ID = "b107b574-3a41-4482-9751-819792aadc89"
DEMO_TENANT_NAME = "Demo Corp"
DEMO_TENANT_SLUG = "demo-corp"
DEMO_USER_EMAIL = "demo@feloxi.dev"
DEMO_USER_PASSWORD = "password123"

# Scale (fast: ~20s to seed)
NUM_TASK_EVENTS = 50_000
NUM_WORKER_EVENTS = 5_000
CH_BATCH_SIZE = 10_000

TASK_NAMES = [
    "app.tasks.send_email", "app.tasks.process_payment", "app.tasks.generate_report",
    "app.tasks.sync_inventory", "app.tasks.resize_image", "app.tasks.send_notification",
    "app.tasks.update_search_index", "app.tasks.calculate_metrics", "app.tasks.backup_database",
    "app.tasks.clean_temp_files", "app.tasks.process_webhook", "app.tasks.send_sms",
    "app.tasks.transcode_video", "app.tasks.import_csv", "app.tasks.export_pdf",
]

QUEUES = ["default", "high-priority",
          "low-priority", "emails", "reports", "payments"]

STATES = ["PENDING", "RECEIVED", "STARTED",
          "SUCCESS", "FAILURE", "RETRY", "REVOKED"]
STATE_WEIGHTS = [0.02, 0.02, 0.03, 0.75, 0.08, 0.07, 0.03]

STATE_TO_EVENT = {
    "PENDING": "task-sent", "RECEIVED": "task-received",
    "STARTED": "task-started", "SUCCESS": "task-succeeded",
    "FAILURE": "task-failed", "RETRY": "task-retried",
    "REVOKED": "task-revoked",
}

WORKER_EVENT_TYPES = ["worker-online", "worker-heartbeat", "worker-offline"]

WORKERS = [
    "celery@worker-alpha-1", "celery@worker-alpha-2",
    "celery@worker-beta-1", "celery@worker-beta-2",
    "celery@worker-gamma-1", "celery@worker-gamma-2",
]


# ── Helpers ────────────────────────────────────────────────

def random_uuid():
    return str(uuid.uuid4())


def random_dt(start, end):
    delta = end - start
    return start + timedelta(seconds=random.random() * delta.total_seconds())


def format_dt(dt):
    return dt.strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]


def pg_conn_str():
    return f"postgres://{PG_USER}:{PG_PASS}@{PG_HOST}:{PG_PORT}/{PG_DB}"


def pg_exec(sql):
    """Execute SQL against PostgreSQL via psql."""
    result = subprocess.run(
        ["psql", pg_conn_str(), "-q", "-t", "-A"],
        input=sql, capture_output=True, text=True, timeout=30,
    )
    if result.returncode != 0:
        errors = [l for l in result.stderr.strip().split('\n')
                  if 'NOTICE' not in l and l.strip()]
        if errors:
            print(f"  PG Error: {'; '.join(errors)}", file=sys.stderr)
    return result.stdout.strip()


def ch_url():
    """Build ClickHouse HTTP URL with optional auth params."""
    params = "database=feloxi"
    if CH_USER:
        params += f"&user={CH_USER}"
    if CH_PASSWORD:
        params += f"&password={CH_PASSWORD}"
    return f"http://{CH_HOST}:{CH_PORT}/?{params}"


def ch_query(sql):
    """Execute a ClickHouse query via HTTP API."""
    req = Request(ch_url(), data=sql.encode("utf-8"), method="POST")
    try:
        with urlopen(req, timeout=60) as resp:
            return resp.read().decode("utf-8").strip()
    except URLError as e:
        print(f"  CH Error: {e}", file=sys.stderr)
        return ""


def ch_insert_tsv(table, tsv_data):
    """Insert TSV data into ClickHouse via HTTP API."""
    sql = f"INSERT INTO {table} FORMAT TabSeparated\n{tsv_data}"
    req = Request(ch_url(), data=sql.encode("utf-8"), method="POST")
    try:
        with urlopen(req, timeout=120) as resp:
            resp.read()
        return True
    except URLError as e:
        print(f"  CH Insert Error: {e}", file=sys.stderr)
        return False


def redis_exec(commands):
    """Execute Redis commands via redis-cli."""
    result = subprocess.run(
        ["redis-cli", "-h", REDIS_HOST, "-p", REDIS_PORT],
        input=commands, capture_output=True, text=True, timeout=30,
    )
    return result.stdout


# ── Wait for services ──────────────────────────────────────

def wait_for_services(max_wait=60):
    """Wait for PostgreSQL, ClickHouse, and Redis to be ready."""
    print("Waiting for services...")
    start = time.time()

    while time.time() - start < max_wait:
        try:
            # Check PostgreSQL
            pg_result = subprocess.run(
                ["psql", pg_conn_str(), "-q", "-t", "-A"],
                input="SELECT 1;", capture_output=True, text=True, timeout=10,
            )
            if pg_result.returncode != 0:
                raise Exception(f"PostgreSQL not ready: {pg_result.stderr.strip()}")

            # Check ClickHouse (/ping needs no auth and rejects query params)
            req = Request(f"http://{CH_HOST}:{CH_PORT}/ping")
            with urlopen(req, timeout=5) as resp:
                resp.read()

            # Check Redis
            result = subprocess.run(
                ["redis-cli", "-h", REDIS_HOST, "-p", REDIS_PORT, "ping"],
                capture_output=True, text=True, timeout=5,
            )
            if "PONG" in result.stdout:
                print("  All services ready.")
                return True
            else:
                raise Exception(f"Redis not ready: {result.stdout.strip()}")
        except Exception as e:
            elapsed = int(time.time() - start)
            print(f"  [{elapsed}s] {e}", flush=True)

        time.sleep(2)

    print("  Timed out waiting for services!", file=sys.stderr)
    return False


# ── Idempotency check ─────────────────────────────────────

def already_seeded():
    """Check if demo tenant already exists."""
    result = pg_exec(
        f"SELECT count(*) FROM tenants WHERE slug = '{DEMO_TENANT_SLUG}';"
    )
    try:
        return int(result) > 0
    except (ValueError, TypeError):
        return False


# ── PostgreSQL Seeding ─────────────────────────────────────

def seed_postgres():
    print("\n  Seeding PostgreSQL...")
    tid = DEMO_TENANT_ID

    # Tenant
    pg_exec(f"""
INSERT INTO tenants (id, name, slug)
VALUES ('{tid}', '{DEMO_TENANT_NAME}', '{DEMO_TENANT_SLUG}')
ON CONFLICT (slug) DO NOTHING;
""")

    # Roles
    roles = {
        "admin": '["tasks:read","tasks:write","tasks:retry","tasks:revoke","workers:read","workers:write","workers:shutdown","alerts:read","alerts:write","metrics:read","settings:read","settings:write","team:read","team:manage"]',
        "editor": '["tasks:read","tasks:write","tasks:retry","tasks:revoke","workers:read","workers:write","alerts:read","alerts:write","metrics:read","settings:read"]',
        "viewer": '["tasks:read","workers:read","alerts:read","metrics:read","settings:read"]',
    }
    role_ids = {}
    for rname, perms in roles.items():
        rid = random_uuid()
        role_ids[rname] = rid
        pg_exec(f"""
INSERT INTO roles (id, tenant_id, name, permissions, is_system)
VALUES ('{rid}', '{tid}', '{rname}', '{perms}', true)
ON CONFLICT (tenant_id, name) DO NOTHING;
""")
        # Get actual ID in case it already existed
        actual = pg_exec(
            f"SELECT id FROM roles WHERE tenant_id = '{tid}' AND name = '{rname}';")
        if actual:
            role_ids[rname] = actual

    # Demo user
    admin_uid = random_uuid()
    admin_pw_hash = hash_password(DEMO_USER_PASSWORD)
    pg_exec(f"""
INSERT INTO users (id, tenant_id, email, password_hash, display_name)
VALUES ('{admin_uid}', '{tid}', '{DEMO_USER_EMAIL}', '{admin_pw_hash}', 'Demo Admin')
ON CONFLICT (tenant_id, email) DO NOTHING;
""")
    actual_uid = pg_exec(
        f"SELECT id FROM users WHERE tenant_id = '{tid}' AND email = '{DEMO_USER_EMAIL}';")
    if actual_uid:
        admin_uid = actual_uid

    pg_exec(f"""
INSERT INTO user_roles (user_id, role_id)
VALUES ('{admin_uid}', '{role_ids["admin"]}')
ON CONFLICT DO NOTHING;
""")

    # Viewer user
    viewer_uid = random_uuid()
    viewer_pw_hash = hash_password(DEMO_USER_PASSWORD)
    pg_exec(f"""
INSERT INTO users (id, tenant_id, email, password_hash, display_name)
VALUES ('{viewer_uid}', '{tid}', 'viewer@feloxi.dev', '{viewer_pw_hash}', 'Demo Viewer')
ON CONFLICT (tenant_id, email) DO NOTHING;
""")
    actual_vid = pg_exec(
        f"SELECT id FROM users WHERE tenant_id = '{tid}' AND email = 'viewer@feloxi.dev';")
    if actual_vid:
        viewer_uid = actual_vid

    pg_exec(f"""
INSERT INTO user_roles (user_id, role_id)
VALUES ('{viewer_uid}', '{role_ids["viewer"]}')
ON CONFLICT DO NOTHING;
""")

    # Broker configs
    for btype, url in [("redis", "redis://redis:6379/0"), ("rabbitmq", "amqp://guest:guest@rabbitmq:5672")]:
        pg_exec(f"""
INSERT INTO broker_configs (tenant_id, name, broker_type, connection_enc)
SELECT '{tid}', '{btype}-primary', '{btype}', 'encrypted:{url}'
WHERE NOT EXISTS (
    SELECT 1 FROM broker_configs WHERE tenant_id = '{tid}' AND name = '{btype}-primary'
);
""")

    # Alert rules
    alerts = [
        ('High Failure Rate',
         '{"type":"task_failure_rate","task_name":"*","threshold":0.1,"window_minutes":5}'),
        ('Slow Task Alert',
         '{"type":"task_duration","task_name":"app.tasks.generate_report","threshold_seconds":60,"percentile":0.95}'),
        ('Worker Down', '{"type":"worker_offline","grace_period_seconds":120}'),
    ]
    for aname, cond in alerts:
        pg_exec(f"""
INSERT INTO alert_rules (tenant_id, name, condition, channels, cooldown_secs)
SELECT '{tid}', '{aname}', '{cond}',
'[{{"type":"webhook","url":"https://hooks.example.com/feloxi"}}]', 300
WHERE NOT EXISTS (
    SELECT 1 FROM alert_rules WHERE tenant_id = '{tid}' AND name = '{aname}'
);
""")

    # Retention policies
    for rtype, days in [("task_events", 90), ("worker_events", 30), ("alert_history", 365)]:
        pg_exec(f"""
INSERT INTO retention_policies (tenant_id, resource_type, retention_days)
VALUES ('{tid}', '{rtype}', {days})
ON CONFLICT (tenant_id, resource_type) DO NOTHING;
""")

    # API key
    key_prefix = "fp_demo_"[:8]
    key_hash = sha256(f"fp_demo_{random_uuid()}".encode()).hexdigest()
    pg_exec(f"""
INSERT INTO api_keys (tenant_id, created_by, name, key_prefix, key_hash, permissions)
SELECT '{tid}', '{admin_uid}', 'Demo Agent Key', '{key_prefix}',
'{key_hash}', '["tasks:read","tasks:write","workers:read","workers:write"]'
WHERE NOT EXISTS (
    SELECT 1 FROM api_keys WHERE tenant_id = '{tid}' AND name = 'Demo Agent Key'
);
""")

    counts = pg_exec("""
SELECT 'tenants: ' || count(*) FROM tenants
UNION ALL SELECT 'users: ' || count(*) FROM users
UNION ALL SELECT 'alert_rules: ' || count(*) FROM alert_rules
UNION ALL SELECT 'broker_configs: ' || count(*) FROM broker_configs;
""")
    print(f"    {counts.replace(chr(10), ', ')}")

    return admin_uid


# ── ClickHouse Seeding ─────────────────────────────────────

def seed_clickhouse():
    print("\n  Seeding ClickHouse...")

    # Check if already seeded
    existing = ch_query("SELECT count() FROM task_events")
    try:
        if int(existing) > 0:
            print(f"    Already has {existing} task events, skipping.")
            return
    except (ValueError, TypeError):
        pass

    tid = DEMO_TENANT_ID
    agent_id = random_uuid()  # Fake agent ID for demo data
    now = datetime.now(timezone.utc)
    start_time = now - timedelta(days=7)

    # ── Task Events ──
    print(f"    Inserting {NUM_TASK_EVENTS:,} task events...")
    total = 0
    batch_num = 0

    while total < NUM_TASK_EVENTS:
        batch_size = min(CH_BATCH_SIZE, NUM_TASK_EVENTS - total)
        batch_num += 1
        rows = []

        for _ in range(batch_size):
            worker = random.choice(WORKERS)
            task_name = random.choice(TASK_NAMES)
            queue = random.choice(QUEUES)
            state = random.choices(STATES, weights=STATE_WEIGHTS, k=1)[0]
            event_type = STATE_TO_EVENT[state]
            ts = random_dt(start_time, now)
            ts_str = format_dt(ts)

            runtime = round(random.uniform(0.01, 120.0), 3) if state in (
                "SUCCESS", "FAILURE") else 0.0
            retries = random.randint(0, 3) if state == "RETRY" else 0

            args = json.dumps([random.randint(1, 100)]
                              ) if random.random() < 0.3 else ""
            kwargs = json.dumps({"key": random.choice(
                ["a", "b", "c"])}) if random.random() < 0.2 else ""
            result = json.dumps(
                {"status": "ok"}) if state == "SUCCESS" and random.random() < 0.1 else ""
            exception = "ValueError: something went wrong" if state == "FAILURE" else ""
            traceback_str = f"Traceback (most recent call last): File tasks.py {exception}" if state == "FAILURE" and random.random(
            ) < 0.5 else ""

            root_id = "\\N"
            parent_id = "\\N"
            group_id = random_uuid() if random.random() < 0.05 else "\\N"
            chord_id = "\\N"

            queued_at = format_dt(
                ts - timedelta(seconds=random.uniform(0.1, 10))) if random.random() < 0.6 else "\\N"
            started_at = format_dt(ts - timedelta(seconds=random.uniform(0.01, 5))
                                   ) if state in ("STARTED", "SUCCESS", "FAILURE") else "\\N"

            broker_type = "redis"
            ingested_at = format_dt(
                ts + timedelta(milliseconds=random.randint(1, 100)))

            row = "\t".join([
                tid, random_uuid(), random_uuid(), task_name, queue, worker,
                state, event_type, ts_str, args, kwargs, result,
                exception, traceback_str, str(runtime), str(retries),
                root_id, parent_id, group_id, chord_id,
                queued_at, started_at, agent_id, broker_type, ingested_at,
            ])
            rows.append(row)

        tsv = "\n".join(rows) + "\n"
        ok = ch_insert_tsv("task_events", tsv)
        total += batch_size
        pct = (total / NUM_TASK_EVENTS) * 100
        status = "OK" if ok else "FAIL"
        print(
            f"      Batch {batch_num}: {total:>8,} / {NUM_TASK_EVENTS:,} ({pct:.0f}%) [{status}]")

    # ── Worker Events ──
    print(f"    Inserting {NUM_WORKER_EVENTS:,} worker events...")
    total = 0
    batch_num = 0

    while total < NUM_WORKER_EVENTS:
        batch_size = min(CH_BATCH_SIZE, NUM_WORKER_EVENTS - total)
        batch_num += 1
        rows = []

        for _ in range(batch_size):
            worker = random.choice(WORKERS)
            hostname = worker.split("@")[1] if "@" in worker else worker
            event_type = random.choices(WORKER_EVENT_TYPES, weights=[
                                        0.05, 0.90, 0.05], k=1)[0]

            ts = random_dt(start_time, now)
            ts_str = format_dt(ts)

            active_tasks = random.randint(0, 50)
            processed = random.randint(1000, 500000)
            load_avg = f"[{random.uniform(0, 8):.2f},{random.uniform(0, 8):.2f},{random.uniform(0, 8):.2f}]"
            cpu_percent = round(random.uniform(0, 100), 1)
            memory_mb = round(random.uniform(100, 4096), 1)
            pool_size = random.choice([4, 8, 16, 32])
            pool_type = random.choice(["prefork", "eventlet", "gevent"])
            sw_ident = "py-celery"
            sw_ver = random.choice(["5.3.6", "5.4.0"])
            ingested_at = format_dt(
                ts + timedelta(milliseconds=random.randint(1, 50)))

            row = "\t".join([
                tid, random_uuid(), worker, hostname, event_type, ts_str,
                str(active_tasks), str(processed), load_avg,
                str(cpu_percent), str(memory_mb), str(pool_size),
                pool_type, sw_ident, sw_ver, agent_id, ingested_at,
            ])
            rows.append(row)

        tsv = "\n".join(rows) + "\n"
        ok = ch_insert_tsv("worker_events", tsv)
        total += batch_size
        pct = (total / NUM_WORKER_EVENTS) * 100
        status = "OK" if ok else "FAIL"
        print(
            f"      Batch {batch_num}: {total:>8,} / {NUM_WORKER_EVENTS:,} ({pct:.0f}%) [{status}]")

    # Verify
    task_count = ch_query("SELECT count() FROM task_events")
    worker_count = ch_query("SELECT count() FROM worker_events")
    print(
        f"    ClickHouse: {task_count} task events, {worker_count} worker events")


# ── Redis Seeding ──────────────────────────────────────────

def seed_redis():
    print("\n  Seeding Redis...")

    tid = DEMO_TENANT_ID
    cmds = []

    for worker in WORKERS:
        hostname = worker.split("@")[1]
        is_online = random.random() < 0.8

        state = json.dumps({
            "worker_id": worker,
            "hostname": hostname,
            "status": "online" if is_online else "offline",
            "active_tasks": random.randint(0, 20) if is_online else 0,
            "processed": random.randint(5000, 200000),
            "cpu_percent": round(random.uniform(5, 95), 1) if is_online else 0,
            "memory_mb": round(random.uniform(256, 2048), 1) if is_online else 0,
            "pool_size": random.choice([4, 8, 16]),
            "pool_type": "prefork",
            "sw_ver": "5.3.6",
        })

        key = f"fp:{tid}:worker:state:{worker}"
        cmds.append(f"SET {key} '{state}' EX 600")

        if is_online:
            hb_key = f"fp:{tid}:worker:heartbeat:{worker}"
            cmds.append(f"SET {hb_key} {int(time.time())} EX 600")
            cmds.append(f"SADD fp:{tid}:workers:online {worker}")

    for q in QUEUES:
        depth = random.randint(0, 500)
        cmds.append(f"SET fp:{tid}:queue:depth:{q} {depth} EX 600")
        cmds.append(f"SADD fp:{tid}:queues:active {q}")

    redis_exec("\n".join(cmds))

    dbsize = redis_exec("DBSIZE").strip()
    print(f"    Redis: {dbsize}")


# ── Main ───────────────────────────────────────────────────

if __name__ == "__main__":
    print("\nFeloxi Demo Seeder")
    print("=" * 50)

    if not wait_for_services():
        sys.exit(1)

    if already_seeded():
        print(
            f"\n  Demo tenant '{DEMO_TENANT_SLUG}' already exists. Skipping seed.")
        print("  To re-seed, remove volumes: docker compose down -v")
        print("\n  Demo login:")
        print(f"    Org:      {DEMO_TENANT_SLUG}")
        print(f"    Email:    {DEMO_USER_EMAIL}")
        print(f"    Password: password123")
        sys.exit(0)

    start = time.time()

    seed_postgres()
    seed_clickhouse()
    seed_redis()

    elapsed = time.time() - start
    print(f"\n{'=' * 50}")
    print(f"  Seeding complete in {elapsed:.1f}s")
    print(f"\n  Demo login:")
    print(f"    Org:      {DEMO_TENANT_SLUG}")
    print(f"    Email:    {DEMO_USER_EMAIL}")
    print(f"    Password: password123")
    print(f"{'=' * 50}")
