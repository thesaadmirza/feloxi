from celery import Celery

app = Celery("feloxi-example")
app.config_from_object("celeryconfig")
