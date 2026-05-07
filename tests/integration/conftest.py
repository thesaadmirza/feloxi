"""
Shared fixtures for Feloxi integration tests.

Each test gets a registered Feloxi broker config and a running Celery worker.
Containers are session-scoped (started once per test run) to avoid the overhead
of spinning up Redis/RabbitMQ for every test function.
"""

import os
import subprocess
import sys
import time
from pathlib import Path

import httpx
import pytest
from testcontainers.rabbitmq import RabbitMqContainer
from testcontainers.redis import RedisContainer

FELOXI_API_URL = os.environ.get("FELOXI_API_URL", "http://localhost:8080")
FELOXI_EMAIL = os.environ.get("FELOXI_EMAIL", "demo@feloxi.dev")
FELOXI_PASSWORD = os.environ.get("FELOXI_PASSWORD", "password123")
WORKER_STARTUP_TIMEOUT = int(os.environ.get("WORKER_STARTUP_TIMEOUT", "15"))
EVENT_TIMEOUT = int(os.environ.get("EVENT_TIMEOUT", "30"))

EXAMPLES_APP_DIR = Path(__file__).parent.parent.parent / "examples" / "app"

# Make example app importable (tasks.*, app, celeryconfig) in all test files.
sys.path.insert(0, str(EXAMPLES_APP_DIR))


@pytest.fixture(scope="session")
def api_client():
    # Auth uses HttpOnly cookies (fp_access). httpx.Client stores them automatically
    # after login, so all subsequent requests within this session are authenticated.
    with httpx.Client(base_url=FELOXI_API_URL, timeout=15) as client:
        resp = client.post(
            "/api/v1/auth/login",
            json={"email": FELOXI_EMAIL, "password": FELOXI_PASSWORD},
        )
        resp.raise_for_status()
        yield client


@pytest.fixture(scope="session")
def redis_container():
    with RedisContainer("redis:7-alpine") as container:
        yield container


@pytest.fixture(scope="session")
def rabbitmq_container():
    with RabbitMqContainer("rabbitmq:3.13-alpine") as container:
        yield container


def _register_broker(client, name, broker_type, url):
    resp = client.post(
        "/api/v1/brokers",
        json={"name": name, "broker_type": broker_type, "connection_url": url},
    )
    resp.raise_for_status()
    return resp.json()["id"]


def _deregister_broker(client, broker_id):
    client.delete(f"/api/v1/brokers/{broker_id}")


def _make_test_app(broker_url):
    """Return a minimal Celery app that submits tasks directly to the test broker.

    Tests must use this (via send_task) rather than importing and calling task
    functions directly — task functions use the app from examples/app/app.py,
    which reads CELERY_BROKER_URL at import time, not the testcontainer URL.
    """
    from celery import Celery

    # No result backend — tests only verify Feloxi events, not task return values.
    # Using amqp:// as a backend URL raises ImproperlyConfigured, so omit it entirely.
    app = Celery(broker=broker_url)
    app.conf.task_send_sent_event = True
    return app


def _broker_status(client, broker_id):
    resp = client.get(f"/api/v1/brokers/{broker_id}")
    return resp.json().get("status") if resp.is_success else None


def _start_worker(broker_url, queues="default,emails,payments,media,data", hostname=None, concurrency=2):
    # amqp:// is not a valid Celery result backend (removed in Celery 5). Use rpc:// for
    # AMQP brokers, which routes results through the broker exchange. Redis workers can
    # use the broker URL directly.
    result_backend = "rpc://" if broker_url.startswith("amqp://") else broker_url
    env = {
        **os.environ,
        "CELERY_BROKER_URL": broker_url,
        "CELERY_RESULT_BACKEND": result_backend,
        "PYTHONPATH": str(EXAMPLES_APP_DIR),
    }
    cmd = [
        sys.executable, "-m", "celery",
        "-A", "app", "worker",
        "-Q", queues,
        f"--concurrency={concurrency}",
        "--loglevel=warning",
        "--events",
    ]
    if hostname:
        cmd.append(f"--hostname={hostname}@%h")
    proc = subprocess.Popen(
        cmd,
        cwd=EXAMPLES_APP_DIR,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    time.sleep(WORKER_STARTUP_TIMEOUT)
    return proc


def _stop_worker(proc):
    proc.terminate()
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()


def wait_for(condition_fn, timeout=EVENT_TIMEOUT, poll_interval=1.0):
    """Poll condition_fn until it returns truthy or timeout expires."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        result = condition_fn()
        if result:
            return result
        time.sleep(poll_interval)
    raise TimeoutError(f"Condition not met within {timeout}s")


# When Feloxi API runs inside Docker, it cannot reach testcontainer ports via "localhost"
# (localhost inside the container is the container itself). On macOS Docker Desktop,
# host.docker.internal resolves to the host machine, so we use it for broker registration.
# The test process and Celery workers run on the host, so they use localhost directly.
DOCKER_HOST = os.environ.get("FELOXI_DOCKER_HOST", "host.docker.internal")


@pytest.fixture
def redis_broker(api_client, redis_container):
    port = redis_container.get_exposed_port(6379)
    host_url = f"redis://localhost:{port}/0"
    feloxi_url = f"redis://{DOCKER_HOST}:{port}/0"

    broker_id = _register_broker(api_client, "test-redis", "redis", feloxi_url)
    wait_for(lambda: _broker_status(api_client, broker_id) == "connected", timeout=15, poll_interval=0.5)

    worker = _start_worker(host_url)

    yield {"id": broker_id, "url": host_url, "worker": worker}

    _stop_worker(worker)
    _deregister_broker(api_client, broker_id)


@pytest.fixture
def amqp_broker(api_client, rabbitmq_container):
    port = rabbitmq_container.get_exposed_port(5672)
    host_url = f"amqp://guest:guest@localhost:{port}//"
    feloxi_url = f"amqp://guest:guest@{DOCKER_HOST}:{port}//"

    broker_id = _register_broker(api_client, "test-rabbitmq", "rabbitmq", feloxi_url)
    wait_for(lambda: _broker_status(api_client, broker_id) == "connected", timeout=20, poll_interval=0.5)

    worker = _start_worker(host_url)

    yield {"id": broker_id, "url": host_url, "worker": worker}

    _stop_worker(worker)
    _deregister_broker(api_client, broker_id)
