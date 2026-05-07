import random
import time

from app import app


@app.task(name="tasks.email.send_welcome_email", bind=True, max_retries=2)
def send_welcome_email(self, user_id: str, email: str):
    time.sleep(random.uniform(0.05, 0.3))
    return {"status": "sent", "user_id": user_id, "email": email}


@app.task(name="tasks.email.send_digest_email", bind=True, max_retries=2)
def send_digest_email(self, user_id: str, content: dict):
    time.sleep(random.uniform(0.1, 0.5))

    if random.random() < 0.04:
        raise self.retry(
            exc=ConnectionError("SMTP connection refused"),
            countdown=10,
        )

    return {"status": "sent", "user_id": user_id, "articles": len(content.get("items", []))}
