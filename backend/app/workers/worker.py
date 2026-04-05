"""
Celery worker with Beat scheduler.
Runs in the 'worker' Docker container with:
  celery -A app.worker.celery_app worker --beat --scheduler celery_redbeat.RedBeatScheduler
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone

from celery import Celery
from sqlalchemy import create_engine, select, update
from sqlalchemy.orm import Session

from app.config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)

# ── Celery app ────────────────────────────────────────────────────────────────

celery_app = Celery(
    "shopping",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="Asia/Jerusalem",
    enable_utc=True,
    task_track_started=True,
    worker_prefetch_multiplier=1,
    # RedBeat schedule
    redbeat_redis_url=settings.redbeat_redis_url,
    redbeat_key_prefix="shopping:redbeat:",
    beat_scheduler="celery_redbeat.RedBeatScheduler",
    beat_schedule={
        "process-recurring-items": {
            "task": "app.worker.process_recurring_items",
            "schedule": 900,   # every 15 minutes
        },
        "cleanup-old-events": {
            "task": "app.worker.cleanup_old_events",
            "schedule": 86400,  # once a day
        },
    },
)


def get_sync_db() -> Session:
    engine = create_engine(settings.sync_database_url, pool_pre_ping=True)
    return Session(engine)


# ── Recurring items processor ─────────────────────────────────────────────────

@celery_app.task(name="app.worker.process_recurring_items", bind=True, max_retries=3)
def process_recurring_items(self):
    """
    Runs every 15 minutes.
    Finds recurring items due today, auto-adds them (or queues a suggestion),
    then advances next_run_date.
    """
    from app.models.models import RecurringItem, ListItem, ShoppingList, CatalogItem, PushSubscription

    logger.info("Processing recurring items...")
    db = get_sync_db()

    try:
        now = datetime.now(timezone.utc)
        due = db.execute(
            select(RecurringItem).where(
                RecurringItem.next_run_date <= now,
                RecurringItem.is_enabled == True,  # noqa: E712
            )
        ).scalars().all()

        logger.info(f"Found {len(due)} due recurring items")

        for r in due:
            try:
                _handle_recurring(db, r, now)
            except Exception as exc:
                logger.error(f"Error handling recurring {r.id}: {exc}")

        db.commit()
        logger.info("Recurring items processed successfully")

    except Exception as exc:
        db.rollback()
        logger.error(f"Failed to process recurring items: {exc}")
        raise self.retry(exc=exc, countdown=60)
    finally:
        db.close()


def _handle_recurring(db: Session, r: "RecurringItem", now: datetime):
    from app.models.models import ListItem, ShoppingList, CatalogItem

    # Find target list — use target_list_id if set, else most recent active list for household
    if r.target_list_id:
        list_id = r.target_list_id
    else:
        lst = db.execute(
            select(ShoppingList).where(
                ShoppingList.household_id == r.household_id,
                ShoppingList.status == "active",
            ).order_by(ShoppingList.created_at.desc()).limit(1)
        ).scalar_one_or_none()
        if not lst:
            logger.warning(f"No active list for household {r.household_id}, skipping recurring {r.id}")
            _advance_next_run(db, r, now)
            return
        list_id = lst.id

    # Check if item already exists as pending (idempotency)
    existing = db.execute(
        select(ListItem).where(
            ListItem.list_id == list_id,
            ListItem.catalog_item_id == r.catalog_item_id,
            ListItem.status == "pending",
        )
    ).scalar_one_or_none()

    if existing:
        logger.info(f"Recurring {r.id}: item already pending in list, skipping add")
        _advance_next_run(db, r, now)
        return

    if r.auto_add:
        # Auto-add to list
        new_item = ListItem(
            list_id=list_id,
            catalog_item_id=r.catalog_item_id,
            quantity=r.quantity,
            unit=r.unit,
            note="נוסף אוטומטית",
            status="pending",
        )
        db.add(new_item)
        db.flush()

        # Publish realtime event via Redis
        _publish_redis_event(list_id, {
            "type": "item_added",
            "item_id": new_item.id,
            "catalog_item_id": str(r.catalog_item_id),
            "source": "recurring",
        })

        # Send push notification to household admins
        send_push_to_household.delay(
            str(r.household_id),
            "item_added_recurring",
            {"catalog_item_id": str(r.catalog_item_id)},
        )

        logger.info(f"Auto-added recurring item {r.catalog_item_id} to list {list_id}")

    else:
        # Suggest mode — send push notification, don't add to list
        send_push_to_household.delay(
            str(r.household_id),
            "recurring_suggestion",
            {
                "catalog_item_id": str(r.catalog_item_id),
                "recurring_id": str(r.id),
                "suggested_list_id": list_id,
            },
        )
        logger.info(f"Sent suggestion for recurring item {r.catalog_item_id}")

    _advance_next_run(db, r, now)


def _advance_next_run(db: Session, r: "RecurringItem", now: datetime):
    """Advance next_run_date by interval_days."""
    next_run = now + timedelta(days=r.interval_days)
    db.execute(
        update(type(r).__class__)
        .where(type(r).__class__.id == r.id)  # type: ignore
        .values(next_run_date=next_run)
    )
    r.next_run_date = next_run


def _publish_redis_event(list_id: str, event: dict):
    """Synchronous Redis publish from Celery worker."""
    import redis
    r = redis.from_url(settings.redis_url)
    r.publish(f"list:{list_id}", json.dumps(event))
    r.close()


# ── Push notification tasks ───────────────────────────────────────────────────

@celery_app.task(name="app.worker.send_push_to_household", bind=True, max_retries=2)
def send_push_to_household(self, household_id: str, event_type: str, payload: dict):
    """Send push notification to all household admins."""
    from app.models.models import HouseholdMember, PushSubscription, CatalogItem

    db = get_sync_db()
    try:
        # Get all household members (admins for recurring, all for item events)
        members = db.execute(
            select(HouseholdMember).where(HouseholdMember.household_id == household_id)
        ).scalars().all()

        # Build notification text
        catalog_item_id = payload.get("catalog_item_id")
        item_name = "פריט"
        if catalog_item_id:
            cat = db.execute(
                select(CatalogItem).where(CatalogItem.id == catalog_item_id)
            ).scalar_one_or_none()
            if cat:
                item_name = cat.name_he

        messages = {
            "item_added": f"נוסף לרשימה: {item_name}",
            "item_purchased": f"נקנה: {item_name}",
            "item_added_recurring": f"נוסף אוטומטית: {item_name}",
            "recurring_suggestion": f"כדאי לקנות: {item_name}",
        }
        body = messages.get(event_type, f"עדכון: {item_name}")

        for member in members:
            subs = db.execute(
                select(PushSubscription).where(PushSubscription.user_id == member.user_id)
            ).scalars().all()

            for sub in subs:
                _send_webpush(sub, body, payload)

    except Exception as exc:
        logger.error(f"Push send failed: {exc}")
        raise self.retry(exc=exc, countdown=30)
    finally:
        db.close()


def _send_webpush(sub, body: str, data: dict):
    """Fire-and-forget web push. Silently removes invalid subscriptions."""
    if not settings.vapid_private_key:
        return  # VAPID not configured

    try:
        from pywebpush import webpush, WebPushException
        webpush(
            subscription_info={
                "endpoint": sub.endpoint,
                "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
            },
            data=json.dumps({"body": body, "data": data}),
            vapid_private_key=settings.vapid_private_key,
            vapid_claims={"sub": "mailto:admin@shopping-app.local"},
        )
    except Exception as exc:
        logger.warning(f"WebPush failed for subscription {sub.id}: {exc}")


# ── Cleanup task ──────────────────────────────────────────────────────────────

@celery_app.task(name="app.worker.cleanup_old_events")
def cleanup_old_events():
    """Delete mutation events older than 30 days."""
    from app.models.models import MutationEvent
    from sqlalchemy import delete

    db = get_sync_db()
    try:
        cutoff = datetime.now(timezone.utc) - timedelta(days=30)
        result = db.execute(
            delete(MutationEvent).where(MutationEvent.created_at < cutoff)
        )
        db.commit()
        logger.info(f"Cleaned up {result.rowcount} old mutation events")
    finally:
        db.close()
