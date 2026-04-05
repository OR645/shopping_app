import json
from typing import Any, Optional
import redis.asyncio as aioredis
from app.config import get_settings

settings = get_settings()

_redis: Optional[aioredis.Redis] = None


async def get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = await aioredis.from_url(settings.redis_url, decode_responses=True)
    return _redis


# ── Pub/Sub ───────────────────────────────────────────────────────────────────

async def publish_list_event(list_id: str, event: dict[str, Any]) -> None:
    """Publish a realtime event to all subscribers of a list channel."""
    r = await get_redis()
    await r.publish(f"list:{list_id}", json.dumps(event))


async def publish_household_event(household_id: str, event: dict[str, Any]) -> None:
    r = await get_redis()
    await r.publish(f"household:{household_id}", json.dumps(event))


# ── Idempotency ───────────────────────────────────────────────────────────────

async def check_idempotency(key: str) -> Optional[dict]:
    """Returns cached response if key was already processed, else None."""
    r = await get_redis()
    val = await r.get(f"idem:{key}")
    return json.loads(val) if val else None


async def store_idempotency(key: str, response: dict, ttl: int = 86400) -> None:
    """Cache idempotency result for TTL seconds (default 24h)."""
    r = await get_redis()
    await r.setex(f"idem:{key}", ttl, json.dumps(response))


# ── Catalog search cache ──────────────────────────────────────────────────────

async def get_search_cache(query: str) -> Optional[list]:
    r = await get_redis()
    val = await r.get(f"search:{query[:50]}")
    return json.loads(val) if val else None


async def set_search_cache(query: str, results: list, ttl: int = 300) -> None:
    r = await get_redis()
    await r.setex(f"search:{query[:50]}", ttl, json.dumps(results))


# ── Presence (who is currently shopping a list) ───────────────────────────────

async def set_user_presence(list_id: str, user_id: str, ttl: int = 60) -> None:
    r = await get_redis()
    await r.setex(f"presence:{list_id}:{user_id}", ttl, "1")


async def get_list_presence(list_id: str) -> list[str]:
    r = await get_redis()
    keys = await r.keys(f"presence:{list_id}:*")
    return [k.split(":")[-1] for k in keys]
