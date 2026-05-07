"""
Workflow tasks that use Celery primitives (chain, group, chord) to create
multi-step pipelines. These show up as linked DAGs in Feloxi's workflow view.
"""

import random

from celery import chain, chord, group

from app import app
from tasks.data import import_csv
from tasks.email import send_welcome_email
from tasks.media import resize_image
from tasks.payments import validate_payment_method


@app.task(name="tasks.workflows.create_account")
def create_account(user_id: str, user_data: dict):
    import time

    time.sleep(random.uniform(0.1, 0.5))
    return {"user_id": user_id, "account_created": True}


@app.task(name="tasks.workflows.setup_billing")
def setup_billing(prev_result: dict, user_id: str, plan: str):
    import time

    time.sleep(random.uniform(0.1, 0.3))
    return {"user_id": user_id, "plan": plan, "billing_active": True}


@app.task(name="tasks.workflows.aggregate_report_data")
def aggregate_report_data(results: list, month: int, year: int):
    import time

    time.sleep(random.uniform(0.2, 0.8))
    total_rows = sum(r.get("rows_imported", 0) for r in results if isinstance(r, dict))
    return {"month": month, "year": year, "total_rows": total_rows, "sources": len(results)}


def process_new_user(user_id: str, email: str, plan: str = "starter"):
    """
    Chain: validate payment method → create account → send welcome email → set up billing.
    All four tasks appear linked in Feloxi's workflow DAG view.
    """
    return chain(
        validate_payment_method.si(user_id, {"type": "card"}),
        create_account.si(user_id, {"email": email}),
        send_welcome_email.si(user_id, email),
        setup_billing.si(user_id, plan),
    ).delay()


def process_batch_images(image_urls: list):
    """
    Group: resize all images in parallel, then generate thumbnails.
    Shows as a fan-out in Feloxi's workflow view.
    """
    resize_tasks = group(
        resize_image.s(url, ["320x240", "640x480", "1280x960"]) for url in image_urls
    )
    return resize_tasks.delay()


def generate_monthly_report(month: int, year: int):
    """
    Chord: fetch data from multiple sources in parallel, then aggregate.
    Shows as fan-out + fan-in in Feloxi's workflow view.
    """
    data_sources = [
        f"s3://data/{year}/{month:02d}/sales.csv",
        f"s3://data/{year}/{month:02d}/inventory.csv",
        f"s3://data/{year}/{month:02d}/customers.csv",
    ]
    fetch_tasks = group(import_csv.s(src, {"id": "auto"}) for src in data_sources)
    aggregate = aggregate_report_data.s(month=month, year=year)
    return chord(fetch_tasks)(aggregate)
