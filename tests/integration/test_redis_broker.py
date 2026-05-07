"""
Integration tests for Redis broker event ingestion.

Each test submits real Celery tasks through a real Redis broker and asserts that
the Feloxi API reflects the correct state, arguments, and metadata.
"""

import pytest

from conftest import EVENT_TIMEOUT, _make_test_app, wait_for


@pytest.fixture(autouse=True)
def broker(redis_broker):
    return redis_broker


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


def test_task_success_visible(api_client, broker):
    app = _make_test_app(broker["url"])
    result = app.send_task(
        "tasks.email.send_welcome_email",
        args=["user_inttest", "inttest@example.com"],
        queue="emails",
    )

    wait_for(
        lambda: any(t["state"] == "SUCCESS" for t in _get_tasks(api_client, task_id=result.id)),
        timeout=EVENT_TIMEOUT,
    )

    task = _get_tasks(api_client, task_id=result.id)[0]
    assert task["state"] == "SUCCESS"
    assert task["task_name"] == "tasks.email.send_welcome_email"


def test_task_failure_visible(api_client, broker):
    # process_payment fails ~12% of the time. 20 submissions gives >92% chance
    # of observing at least one FAILURE.
    app = _make_test_app(broker["url"])
    ids = [
        app.send_task("tasks.payments.process_payment", args=[f"order_{i}", 9.99, "USD"], queue="payments").id
        for i in range(20)
    ]

    wait_for(
        lambda: any(
            any(t["state"] == "FAILURE" for t in _get_tasks(api_client, task_id=tid))
            for tid in ids
        ),
        timeout=EVENT_TIMEOUT,
    )

    failed = [t for tid in ids for t in _get_tasks(api_client, task_id=tid) if t["state"] == "FAILURE"]
    assert failed, "Expected at least one FAILURE state in 20 payment tasks"


def test_task_retry_visible(api_client, broker):
    app = _make_test_app(broker["url"])
    result = app.send_task("tasks.data.sync_inventory", args=["shop_retry_test"], queue="data")

    wait_for(
        lambda: any(t["state"] in ("SUCCESS", "FAILURE", "RETRY") for t in _get_tasks(api_client, task_id=result.id)),
        timeout=EVENT_TIMEOUT,
    )
    assert _get_tasks(api_client, task_id=result.id), "Task not found in Feloxi"


def test_task_name_and_queue_stored(api_client, broker):
    app = _make_test_app(broker["url"])
    result = app.send_task(
        "tasks.media.generate_thumbnail",
        args=["https://cdn.example.com/test.mp4", 5.0],
        queue="media",
    )

    wait_for(
        lambda: any(t["state"] == "SUCCESS" for t in _get_tasks(api_client, task_id=result.id)),
        timeout=EVENT_TIMEOUT,
    )
    task = _get_tasks(api_client, task_id=result.id)[0]
    assert task["task_name"] == "tasks.media.generate_thumbnail"
    assert task["queue"] == "media"


def test_multiple_queues_visible(api_client, broker):
    app = _make_test_app(broker["url"])
    ids = [
        app.send_task("tasks.email.send_welcome_email", args=["u1", "u1@x.com"], queue="emails").id,
        app.send_task("tasks.data.import_csv", args=["s3://f.csv", {}], queue="data").id,
        app.send_task("tasks.media.generate_thumbnail", args=["https://v.mp4", 0], queue="media").id,
    ]

    wait_for(
        lambda: all(
            any(t["state"] in ("SUCCESS", "FAILURE") for t in _get_tasks(api_client, task_id=tid))
            for tid in ids
        ),
        timeout=EVENT_TIMEOUT,
    )

    queues_seen = {
        _get_tasks(api_client, task_id=tid)[0].get("queue")
        for tid in ids
        if _get_tasks(api_client, task_id=tid)
    }
    assert len(queues_seen) >= 2, f"Expected tasks on multiple queues, got: {queues_seen}"


def test_task_runtime_recorded(api_client, broker):
    app = _make_test_app(broker["url"])
    result = app.send_task(
        "tasks.media.resize_image",
        args=["https://cdn.example.com/img.jpg", ["640x480"]],
        queue="media",
    )

    wait_for(
        lambda: any(t["state"] == "SUCCESS" for t in _get_tasks(api_client, task_id=result.id)),
        timeout=EVENT_TIMEOUT,
    )
    task = _get_tasks(api_client, task_id=result.id)[0]
    assert task.get("runtime") is not None, "Expected runtime to be recorded"
    assert task["runtime"] > 0


def test_broker_status_connected(api_client, broker):
    resp = api_client.get(f"/api/v1/brokers/{broker['id']}")
    resp.raise_for_status()
    assert resp.json()["status"] == "connected"


def test_tasks_list_filterable_by_state(api_client, broker):
    app = _make_test_app(broker["url"])
    for i in range(5):
        app.send_task("tasks.email.send_welcome_email", args=[f"u{i}", f"u{i}@x.com"], queue="emails")

    wait_for(lambda: len(_get_tasks(api_client, state="SUCCESS")) >= 5, timeout=EVENT_TIMEOUT)
    assert all(t["state"] == "SUCCESS" for t in _get_tasks(api_client, state="SUCCESS"))
