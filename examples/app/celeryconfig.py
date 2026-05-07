import os

# ── Task modules ──────────────────────────────────────────────────────────────
# Explicit list of task modules. Celery imports these when the worker starts,
# registering all @app.task decorated functions.
include = [
    "tasks.email",
    "tasks.payments",
    "tasks.media",
    "tasks.data",
    "tasks.workflows",
]

# ── Broker ────────────────────────────────────────────────────────────────────
# This is where your Celery workers publish task events. Feloxi reads from the
# same broker — no agent to install, no SDK to wrap your code with.
broker_url = os.environ.get("CELERY_BROKER_URL", "redis://localhost:6379/0")

# ── Result backend ────────────────────────────────────────────────────────────
# Not required by Feloxi, but useful for your application to retrieve task
# return values. Using the same Redis instance for simplicity.
result_backend = os.environ.get("CELERY_RESULT_BACKEND", "redis://localhost:6379/1")

# ── Event monitoring — required for Feloxi ────────────────────────────────────
# These three settings are all you need to start seeing data in Feloxi.

# Send task-started, task-succeeded, task-failed, task-retried events.
worker_send_task_events = True

# Send task-sent event when a task is published to the broker (shows PENDING
# state in Feloxi before a worker picks it up).
task_send_sent_event = True

# Send task-started event when a worker begins executing a task (shows STARTED
# state in Feloxi, lets you measure queue wait time vs execution time).
task_track_started = True

# ── Serialization ─────────────────────────────────────────────────────────────
task_serializer = "json"
result_serializer = "json"
accept_content = ["json"]

# ── Queue routing ─────────────────────────────────────────────────────────────
# Route tasks to specific queues so you can see per-queue throughput and depth
# in Feloxi's queue view. Workers subscribe to one or more queues via
# `celery worker -Q queue_name`.
task_routes = {
    "tasks.email.*": {"queue": "emails"},
    "tasks.payments.*": {"queue": "payments"},
    "tasks.media.*": {"queue": "media"},
    "tasks.data.*": {"queue": "data"},
}

# Default queue for tasks without an explicit route.
task_default_queue = "default"

# ── Time limits ───────────────────────────────────────────────────────────────
# Soft limit: worker raises SoftTimeLimitExceeded, giving the task a chance to
# clean up. Hard limit: worker kills the task process immediately.
task_soft_time_limit = 300  # 5 minutes
task_time_limit = 360       # 6 minutes

# ── Result TTL ────────────────────────────────────────────────────────────────
# How long to keep task results in the backend. Feloxi stores events separately
# in ClickHouse with a configurable retention policy (default 90 days).
result_expires = 3600  # 1 hour

# ── Worker concurrency ────────────────────────────────────────────────────────
# Number of concurrent tasks per worker process. The compose file overrides
# this with --concurrency when starting workers.
worker_concurrency = 4

# ── Prefetch ──────────────────────────────────────────────────────────────────
# How many tasks a worker fetches at once. Setting to 1 gives you more accurate
# queue depth readings in Feloxi (workers don't hoard tasks).
worker_prefetch_multiplier = 1
