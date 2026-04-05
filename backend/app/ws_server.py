"""
Standalone WebSocket server (port 8001).
Subscribes to Redis pub/sub channels and fans out events to connected clients.
"""
import asyncio
import json
import logging
from typing import Dict, Set

import redis.asyncio as aioredis
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.database import AsyncSessionLocal
from app.models.models import ListMember
from app.services.auth_service import decode_access_token

settings = get_settings()
logger = logging.getLogger(__name__)

app = FastAPI(title="Shopping App — WebSocket Server")

# ── Connection registry ───────────────────────────────────────────────────────
# { list_id: {WebSocket, ...} }
list_connections: Dict[str, Set[WebSocket]] = {}


async def register(list_id: str, ws: WebSocket):
    if list_id not in list_connections:
        list_connections[list_id] = set()
    list_connections[list_id].add(ws)
    logger.info(f"WS connected to list {list_id}. Total connections: {len(list_connections[list_id])}")


async def unregister(list_id: str, ws: WebSocket):
    if list_id in list_connections:
        list_connections[list_id].discard(ws)
        if not list_connections[list_id]:
            del list_connections[list_id]


async def broadcast(list_id: str, message: str, exclude: WebSocket | None = None):
    if list_id not in list_connections:
        return
    dead: Set[WebSocket] = set()
    for ws in list_connections[list_id]:
        if ws is exclude:
            continue
        try:
            await ws.send_text(message)
        except Exception:
            dead.add(ws)
    for ws in dead:
        await unregister(list_id, ws)


# ── WebSocket endpoint ────────────────────────────────────────────────────────

@app.websocket("/ws/lists/{list_id}")
async def list_websocket(
    websocket: WebSocket,
    list_id: str,
    token: str = Query(...),
    cursor: str | None = Query(default=None),
):
    # 1. Authenticate via token in query string
    user_id = decode_access_token(token)
    if not user_id:
        await websocket.close(code=4001, reason="Unauthorized")
        return

    # 2. Verify list membership
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(ListMember).where(
                ListMember.list_id == list_id,
                ListMember.user_id == user_id,
            )
        )
        if not result.scalar_one_or_none():
            await websocket.close(code=4003, reason="Not a list member")
            return

    await websocket.accept()
    await register(list_id, websocket)

    # 3. Send initial sync if cursor provided (replay missed events)
    if cursor:
        await _replay_missed_events(websocket, list_id, cursor)

    # 4. Send presence update
    await broadcast(list_id, json.dumps({
        "type": "presence_update",
        "user_id": user_id,
        "event": "joined",
    }))

    try:
        while True:
            # Keep connection alive — client sends pings
            data = await asyncio.wait_for(websocket.receive_text(), timeout=60)
            msg = json.loads(data)

            # Handle client → server messages
            if msg.get("type") == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
            elif msg.get("type") == "set_presence":
                # Client updates their presence (e.g., started shopping mode)
                await broadcast(list_id, json.dumps({
                    "type": "presence_update",
                    "user_id": user_id,
                    "status": msg.get("status", "browsing"),
                }), exclude=websocket)

    except (WebSocketDisconnect, asyncio.TimeoutError):
        pass
    finally:
        await unregister(list_id, websocket)
        await broadcast(list_id, json.dumps({
            "type": "presence_update",
            "user_id": user_id,
            "event": "left",
        }))


async def _replay_missed_events(ws: WebSocket, list_id: str, since_cursor: str):
    """Send events from MutationEvent log that happened after cursor."""
    from datetime import datetime, timezone
    from app.models.models import MutationEvent

    try:
        since_dt = datetime.fromisoformat(since_cursor)
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(MutationEvent)
                .where(MutationEvent.list_id == list_id, MutationEvent.created_at > since_dt)
                .order_by(MutationEvent.created_at)
                .limit(200)
            )
            events = result.scalars().all()

        if events:
            await ws.send_text(json.dumps({
                "type": "replay",
                "events": [{"type": e.event_type, "payload": e.payload, "ts": e.created_at.isoformat()} for e in events],
            }))
    except Exception as exc:
        logger.error(f"Replay failed: {exc}")


# ── Redis subscriber (background task) ───────────────────────────────────────

@app.on_event("startup")
async def start_redis_subscriber():
    asyncio.create_task(_redis_subscriber())


async def _redis_subscriber():
    """
    Subscribes to Redis pub/sub.
    Incoming messages are fanned out to connected WebSocket clients.
    Pattern: list:* and household:*
    """
    redis = await aioredis.from_url(settings.redis_url, decode_responses=True)
    pubsub = redis.pubsub()
    await pubsub.psubscribe("list:*", "household:*")
    logger.info("Redis subscriber started — listening for list:* and household:* events")

    async for message in pubsub.listen():
        if message["type"] not in ("pmessage", "message"):
            continue
        try:
            channel: str = message.get("channel", "")
            data: str = message.get("data", "{}")

            if channel.startswith("list:"):
                list_id = channel.split(":", 1)[1]
                await broadcast(list_id, data)

        except Exception as exc:
            logger.error(f"Redis subscriber error: {exc}")
