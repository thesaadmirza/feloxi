import random
import time

from app import app


@app.task(name="tasks.payments.process_payment", bind=True, max_retries=3)
def process_payment(self, order_id: str, amount: float, currency: str = "USD"):
    time.sleep(random.uniform(0.2, 1.5))

    if random.random() < 0.12:
        raise ValueError(f"Payment declined for order {order_id}: insufficient funds")

    if random.random() < 0.05:
        raise self.retry(
            exc=TimeoutError("Payment gateway timed out"),
            countdown=30,
        )

    return {
        "status": "charged",
        "order_id": order_id,
        "amount": amount,
        "currency": currency,
        "transaction_id": f"txn_{random.randint(100000, 999999)}",
    }


@app.task(name="tasks.payments.refund_payment", bind=True, max_retries=2)
def refund_payment(self, order_id: str, transaction_id: str):
    time.sleep(random.uniform(0.3, 1.0))

    if random.random() < 0.03:
        raise self.retry(
            exc=TimeoutError("Refund gateway timed out"),
            countdown=60,
        )

    return {"status": "refunded", "order_id": order_id, "transaction_id": transaction_id}


@app.task(name="tasks.payments.validate_payment_method", bind=True, max_retries=1)
def validate_payment_method(self, user_id: str, method_data: dict):
    time.sleep(random.uniform(0.05, 0.4))

    if random.random() < 0.06:
        raise ValueError(f"Invalid payment method for user {user_id}")

    return {"valid": True, "user_id": user_id, "method": method_data.get("type")}
