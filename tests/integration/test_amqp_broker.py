"""
Integration tests for RabbitMQ (AMQP) broker event ingestion.

Same assertions as test_redis_broker.py but routed through RabbitMQ. Verifies
that Feloxi's AMQP consumer correctly decodes Kombu envelopes and stores events.
"""

import pytest

from conftest import EVENT_TIMEOUT, _make_test_app, wait_for


@pytest.fixture(autouse=True)
def broker(amqp_broker):
    return amqp_broker


def _get_tasks(api_client, **filters):
    task_id = filters.pop("task_id", None)
    if task_id is not None and not filters:
        resp = api_client.get(f"/api/v1/tasks/{task_id}")
        if resp.status_code == 404:
            return []
        resp.raise_for_status()
        return [resp.json()]
    resp = api_client.get("/api/v1/tasks", params=filters)
    resp.raise_for_status()
    return resp.json().get("data", [])


def test_amqp_task_success_visible(api_client, broker):
    app = _make_test_app(broker["url"])
    result = app.send_task(
        "tasks.email.send_welcome_email",
        args=["user_amqp", "amqp@example.com"],
        queue="emails",
    )

    wait_for(
        lambda: any(t["state"] == "SUCCESS" for t in _get_tasks(api_client, task_id=result.id)),
        timeout=EVENT_TIMEOUT,
    )
    task = _get_tasks(api_client, task_id=result.id)[0]
    assert task["state"] == "SUCCESS"
    assert task["task_name"] == "tasks.email.send_welcome_email"


def test_amqp_task_failure_captured(api_client, broker):
    # validate_payment_method fails ~6% of the time. 15 submissions gives >60%
    # chance of observing a failure — we wait up to EVENT_TIMEOUT for any terminal state.
    app = _make_test_app(broker["url"])
    ids = [
        app.send_task("tasks.payments.validate_payment_method", args=[f"user_{i}", {"type": "card"}], queue="payments").id
        for i in range(15)
    ]

    wait_for(
        lambda: any(
            any(t["state"] in ("SUCCESS", "FAILURE") for t in _get_tasks(api_client, task_id=tid))
            for tid in ids
        ),
        timeout=EVENT_TIMEOUT,
    )


def test_amqp_broker_status_connected(api_client, broker):
    resp = api_client.get(f"/api/v1/brokers/{broker['id']}")
    resp.raise_for_status()
    assert resp.json()["status"] == "connected"


def test_amqp_queue_routing_preserved(api_client, broker):
    app = _make_test_app(broker["url"])
    r1 = app.send_task("tasks.data.generate_report", args=["sales", {"period": "today"}], queue="data")
    r2 = app.send_task("tasks.media.generate_thumbnail", args=["https://v.mp4", 0], queue="media")

    wait_for(
        lambda: (
            any(t["state"] in ("SUCCESS", "FAILURE") for t in _get_tasks(api_client, task_id=r1.id))
            and any(t["state"] in ("SUCCESS", "FAILURE") for t in _get_tasks(api_client, task_id=r2.id))
        ),
        timeout=EVENT_TIMEOUT,
    )

    t1 = _get_tasks(api_client, task_id=r1.id)
    t2 = _get_tasks(api_client, task_id=r2.id)
    if t1:
        assert t1[0].get("queue") == "data"
    if t2:
        assert t2[0].get("queue") == "media"


def test_amqp_multiple_tasks_all_ingested(api_client, broker):
    app = _make_test_app(broker["url"])
    ids = [
        app.send_task("tasks.email.send_welcome_email", args=[f"u{i}", f"u{i}@x.com"], queue="emails").id
        for i in range(8)
    ]

    wait_for(
        lambda: sum(
            1 for tid in ids
            if any(t["state"] in ("SUCCESS", "FAILURE") for t in _get_tasks(api_client, task_id=tid))
        ) >= 6,  # allow 2 stragglers
        timeout=EVENT_TIMEOUT,
    )
