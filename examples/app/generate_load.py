"""
Continuous load generator for the Feloxi example app.

Submits a realistic mix of tasks at a configurable rate, including chains,
groups, and tasks that fail or retry — so every state shows up in Feloxi.

Usage:
  python generate_load.py              # default: 2 tasks/sec
  TASKS_PER_SEC=5 python generate_load.py
"""

import os
import random
import signal
import sys
import time
import uuid

from tasks.data import backup_database, generate_report, import_csv, sync_inventory
from tasks.email import send_digest_email, send_welcome_email
from tasks.media import generate_thumbnail, resize_image, transcode_video
from tasks.payments import process_payment, refund_payment, validate_payment_method
from tasks.workflows import generate_monthly_report, process_batch_images, process_new_user

TASKS_PER_SEC = float(os.environ.get("TASKS_PER_SEC", "2"))
SLEEP = 1.0 / TASKS_PER_SEC

_running = True


def _handle_stop(sig, frame):
    global _running
    print("\nStopping load generator...")
    _running = False


signal.signal(signal.SIGINT, _handle_stop)
signal.signal(signal.SIGTERM, _handle_stop)


def _uid():
    return str(uuid.uuid4())[:8]


# ── Task submitters ───────────────────────────────────────────────────────────

def _submit_welcome_email():
    send_welcome_email.apply_async(
        args=[f"user_{_uid()}", f"user_{_uid()}@example.com"], queue="emails"
    )


def _submit_digest_email():
    send_digest_email.apply_async(
        args=[f"user_{_uid()}", {"items": [f"article_{i}" for i in range(random.randint(1, 5))]}],
        queue="emails",
    )


def _submit_process_payment():
    process_payment.apply_async(
        args=[f"order_{_uid()}", round(random.uniform(5.0, 2000.0), 2), "USD"],
        queue="payments",
    )


def _submit_refund():
    refund_payment.apply_async(args=[f"order_{_uid()}", f"txn_{_uid()}"], queue="payments")


def _submit_validate_payment():
    validate_payment_method.apply_async(
        args=[f"user_{_uid()}", {"type": random.choice(["card", "paypal", "bank"])}],
        queue="payments",
    )


def _submit_resize_image():
    resize_image.apply_async(
        args=[
            f"https://cdn.example.com/img_{_uid()}.jpg",
            random.choice([["320x240"], ["640x480", "1280x960"], ["320x240", "640x480", "1280x960"]]),
        ],
        queue="media",
    )


def _submit_transcode_video():
    transcode_video.apply_async(
        args=[
            f"https://cdn.example.com/vid_{_uid()}.mp4",
            random.choice([["mp4", "webm"], ["mp4"], ["webm", "hls"]]),
        ],
        queue="media",
    )


def _submit_thumbnail():
    generate_thumbnail.apply_async(
        args=[f"https://cdn.example.com/vid_{_uid()}.mp4", random.uniform(0, 120)],
        queue="media",
    )


def _submit_import_csv():
    import_csv.apply_async(
        args=[f"s3://uploads/{_uid()}.csv", {"id": "auto", "email": "col_2", "name": "col_3"}],
        queue="data",
    )


def _submit_generate_report():
    generate_report.apply_async(
        args=[
            random.choice(["sales_summary", "user_activity", "inventory_delta"]),
            {"period": random.choice(["today", "this_week", "this_month"])},
        ],
        queue="data",
    )


def _submit_backup():
    backup_database.apply_async(
        args=[random.choice(["users_db", "orders_db", "analytics_db"])], queue="data"
    )


def _submit_sync_inventory():
    sync_inventory.apply_async(args=[f"shop_{random.randint(1, 20)}"], queue="data")


def _submit_new_user_workflow():
    process_new_user(f"user_{_uid()}", f"user_{_uid()}@example.com")


def _submit_batch_images():
    process_batch_images(
        [f"https://cdn.example.com/img_{_uid()}.jpg" for _ in range(random.randint(2, 6))]
    )


def _submit_monthly_report():
    now = time.localtime()
    generate_monthly_report(now.tm_mon, now.tm_year)


# Weighted dispatch table: (weight, submitter). Weights are relative.
_DISPATCH = [
    (15, _submit_welcome_email),
    (10, _submit_digest_email),
    (14, _submit_process_payment),
    (4, _submit_refund),
    (5, _submit_validate_payment),
    (10, _submit_resize_image),
    (5, _submit_transcode_video),
    (5, _submit_thumbnail),
    (8, _submit_import_csv),
    (6, _submit_generate_report),
    (4, _submit_backup),
    (6, _submit_sync_inventory),
    (4, _submit_new_user_workflow),
    (3, _submit_batch_images),
    (1, _submit_monthly_report),
]

_WEIGHTS, _SUBMITTERS = zip(*_DISPATCH)


def _submit_one():
    fn = random.choices(_SUBMITTERS, weights=_WEIGHTS, k=1)[0]
    fn()


def main():
    print(f"Load generator started — {TASKS_PER_SEC} tasks/sec")
    print("Press Ctrl+C to stop.\n")

    submitted = 0
    while _running:
        try:
            _submit_one()
            submitted += 1
            if submitted % 50 == 0:
                print(f"  {submitted} tasks submitted")
        except Exception as exc:
            print(f"  [warn] submit failed: {exc}")

        time.sleep(SLEEP)

    print(f"\nDone. Total tasks submitted: {submitted}")


if __name__ == "__main__":
    main()
