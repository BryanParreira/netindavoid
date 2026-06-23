from celery import Celery
from celery.schedules import crontab

from core.config import settings

celery_app = Celery(
    "vex",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
    include=["workers.tasks"],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
)

celery_app.conf.beat_schedule = {
    "network-scan-every-60s": {
        "task": "workers.tasks.run_periodic_scan",
        "schedule": settings.SCAN_INTERVAL_SECONDS,
    },
    "collect-traffic-dns-every-30s": {
        "task": "workers.tasks.collect_traffic_dns",
        "schedule": 30.0,
    },
    "suricata-ingest-every-10s": {
        "task": "workers.tasks.ingest_suricata_events",
        "schedule": 10.0,
    },
    "security-score-every-5min": {
        "task": "workers.tasks.compute_security_scores",
        "schedule": crontab(minute="*/5"),
    },
}
