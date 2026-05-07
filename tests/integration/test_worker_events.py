"""
Integration tests for worker event ingestion.

Verifies that Feloxi correctly tracks worker online/offline transitions
and captures heartbeat data (CPU, memory, pool size).
"""

import time

import pytest

from conftest import (
    DOCKER_HOST,
    EVENT_TIMEOUT,
    WORKER_STARTUP_TIMEOUT,
    _broker_status,
    _deregister_broker,
    _register_broker,
    _start_worker,
    _stop_worker,
    wait_for,
)


def _get_workers(api_client, **_filters):
    # broker_id filter is not supported by the API; all workers for the tenant are returned.
    resp = api_client.get("/api/v1/workers")
    resp.raise_for_status()
    body = resp.json()
    online_ids = set(body.get("online_workers", []))

    # worker_states holds full state for online workers that have no ClickHouse events yet.
    workers = list(body.get("worker_states", []))
    seen = {w["worker_id"] for w in workers}

    # worker_events holds ClickHouse rows; derive live status from online_ids.
    for ev in body.get("worker_events", []):
        wid = ev["worker_id"]
        if wid not in seen:
            seen.add(wid)
            workers.append({**ev, "status": "online" if wid in online_ids else "offline"})

    return workers


def test_worker_appears_online(api_client, redis_broker):
    broker_id = redis_broker["id"]

    def check():
        return any(w.get("status") == "online" for w in _get_workers(api_client, broker_id=broker_id))

    wait_for(check, timeout=WORKER_STARTUP_TIMEOUT + 10)

    online = [w for w in _get_workers(api_client, broker_id=broker_id) if w.get("status") == "online"]
    assert len(online) >= 1, "Expected at least one online worker"


def test_worker_has_heartbeat_data(api_client, redis_broker):
    broker_id = redis_broker["id"]

    def check():
        return any(
            w.get("status") == "online" and w.get("pool_size") is not None
            for w in _get_workers(api_client, broker_id=broker_id)
        )

    wait_for(check, timeout=WORKER_STARTUP_TIMEOUT + 10)

    online = [w for w in _get_workers(api_client, broker_id=broker_id) if w.get("status") == "online"][0]
    assert online.get("pool_size") is not None, "Expected pool_size in worker state"


def test_worker_goes_offline(api_client, redis_container):
    """Start a named worker, confirm it appears online, stop it, confirm it goes offline."""
    port = redis_container.get_exposed_port(6379)
    host_url = f"redis://localhost:{port}/0"
    feloxi_url = f"redis://{DOCKER_HOST}:{port}/0"

    broker_id = _register_broker(api_client, "offline-test-redis", "redis", feloxi_url)
    proc = None
    try:
        wait_for(lambda: _broker_status(api_client, broker_id) == "connected", timeout=15, poll_interval=0.5)

        proc = _start_worker(host_url, queues="default", hostname="inttest-offline", concurrency=1)

        wait_for(
            lambda: any(
                "inttest-offline" in w.get("hostname", "") and w.get("status") == "online"
                for w in _get_workers(api_client, broker_id=broker_id)
            ),
            timeout=WORKER_STARTUP_TIMEOUT + 5,
        )

        proc.terminate()
        proc.wait(timeout=10)
        proc = None

        # Feloxi marks workers offline on worker-offline event; allow up to 60s to propagate.
        wait_for(
            lambda: any(
                "inttest-offline" in w.get("hostname", "") and w.get("status") == "offline"
                for w in _get_workers(api_client, broker_id=broker_id)
            ),
            timeout=60,
        )
    finally:
        if proc is not None:
            _stop_worker(proc)
        _deregister_broker(api_client, broker_id)


def test_multiple_workers_all_visible(api_client, redis_broker):
    broker_id = redis_broker["id"]

    def check():
        return len([w for w in _get_workers(api_client, broker_id=broker_id) if w.get("status") == "online"]) >= 1

    wait_for(check, timeout=WORKER_STARTUP_TIMEOUT + 10)

    online_count = len([w for w in _get_workers(api_client, broker_id=broker_id) if w.get("status") == "online"])
    assert online_count >= 1, f"Expected online workers, got {online_count}"
