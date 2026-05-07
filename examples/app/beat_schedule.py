"""
Celery Beat periodic task schedule.

Run with: celery -A app beat --loglevel=info
These tasks appear in Feloxi's task list at their scheduled intervals.
"""

from celery.schedules import crontab

from app import app

app.conf.beat_schedule = {
    # Health check every 30 seconds — produces a steady heartbeat of tasks.
    "check-system-health": {
        "task": "tasks.data.backup_database",
        "schedule": 30.0,
        "args": ("health_check_db",),
        "options": {"queue": "default"},
    },
    # Sync inventory for 5 shops every 2 minutes.
    "sync-all-inventories": {
        "task": "tasks.data.sync_inventory",
        "schedule": 120.0,
        "args": ("shop_main",),
        "options": {"queue": "data"},
    },
    # Send digest emails — every 5 minutes in this example (hourly in production).
    "send-digest-emails": {
        "task": "tasks.email.send_digest_email",
        "schedule": 300.0,
        "args": ("system", {"items": ["update_1", "update_2", "update_3"]}),
        "options": {"queue": "emails"},
    },
    # Generate daily report at midnight (crontab syntax).
    "daily-report": {
        "task": "tasks.data.generate_report",
        "schedule": crontab(hour=0, minute=0),
        "args": ("daily_summary", {"period": "yesterday"}),
        "options": {"queue": "data"},
    },
}

app.conf.timezone = "UTC"
