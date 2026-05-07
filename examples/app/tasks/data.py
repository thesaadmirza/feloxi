import random
import time

from app import app


@app.task(name="tasks.data.import_csv", bind=True, max_retries=2)
def import_csv(self, file_url: str, mapping: dict):
    rows = random.randint(500, 50000)
    time.sleep(random.uniform(0.5, 4.0))

    if random.random() < 0.07:
        raise ValueError(f"Schema mismatch in {file_url}: column 'email' missing")

    return {"file": file_url, "rows_imported": rows, "errors": 0}


@app.task(name="tasks.data.generate_report", bind=True, max_retries=1)
def generate_report(self, report_type: str, params: dict):
    time.sleep(random.uniform(1.0, 8.0))

    if random.random() < 0.06:
        raise MemoryError(f"Report {report_type} exceeded memory limit")

    return {
        "report_type": report_type,
        "rows": random.randint(100, 10000),
        "url": f"s3://reports/{report_type}_{params.get('period', 'latest')}.pdf",
    }


@app.task(name="tasks.data.backup_database", bind=True, max_retries=3)
def backup_database(self, db_name: str):
    time.sleep(random.uniform(0.5, 3.0))

    if random.random() < 0.03:
        raise self.retry(
            exc=IOError("Backup storage unreachable"),
            countdown=120,
        )

    return {
        "db": db_name,
        "size_mb": random.randint(50, 5000),
        "location": f"s3://backups/{db_name}/backup_latest.tar.gz",
    }


@app.task(name="tasks.data.sync_inventory", bind=True, max_retries=2)
def sync_inventory(self, shop_id: str):
    time.sleep(random.uniform(0.3, 2.0))

    if random.random() < 0.08:
        raise self.retry(
            exc=ConnectionError("Inventory API rate limited"),
            countdown=30,
        )

    return {"shop_id": shop_id, "products_synced": random.randint(10, 5000)}
