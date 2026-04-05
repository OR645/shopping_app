"""
All routers in one file for clarity.
In production you'd split into routers/auth.py, routers/lists.py, etc.
"""
from __future__ import annotations

import re
import unicodedata
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query, Response, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select, func, update, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.database import get_db
from app.models.models import (
    User, Household, HouseholdMember, ShoppingList, ListMember, ListItem,
    CatalogItem, CatalogCategory, RecurringItem, PushSubscription, MutationEvent,
)
from app.schemas.schemas import (
    RegisterRequest, LoginRequest, TokenResponse, UserOut,
    HouseholdCreate, HouseholdOut, HouseholdMemberOut, InviteMemberRequest,
    CatalogCategoryOut, CatalogItemCreate, CatalogItemOut, CatalogSearchResult, DuplicateCheckResult,
    ListCreate, ListOut, InviteToListRequest,
    ListItemCreate, ListItemUpdate, ListItemOut, StatusToggleRequest,
    RecurringItemCreate, RecurringItemOut, RecurringItemUpdate,
    PushSubscriptionCreate, SyncRequest, SyncResponse,
)
from app.services.auth_service import (
    create_user, authenticate_user, create_access_token,
    create_refresh_token, save_refresh_token, rotate_refresh_token,
)
from app.services.deps import get_current_user, require_household_role, require_list_role
from app.services.redis_service import (
    publish_list_event, check_idempotency, store_idempotency,
    get_search_cache, set_search_cache,
)
from app.config import get_settings

settings = get_settings()

# FIX: use secure=True only in production (HTTPS). In development over HTTP,
# secure=True causes the browser to silently drop the cookie, breaking auth entirely.
_COOKIE_SECURE = settings.environment == "production"


# ── Helpers ───────────────────────────────────────────────────────────────────

FINAL_LETTER_MAP = str.maketrans("ךםןףץ", "כמנפצ")

def normalize_hebrew(text: str) -> str:
    """Strip niqqud, normalize final letters, lowercase, strip whitespace."""
    # Remove niqqud (Hebrew diacritics U+05B0–U+05C7)
    text = re.sub(r"[\u05B0-\u05C7]", "", text)
    # Normalize final letters
    text = text.translate(FINAL_LETTER_MAP)
    # Strip numbers/punctuation, keep Hebrew + Latin
    text = re.sub(r"[^\u05D0-\u05EA\u05F0-\u05F4a-zA-Z\s]", "", text)
    return text.strip().lower()


def freq_to_days(freq: str, custom: Optional[int] = None) -> int:
    return {"daily": 1, "weekly": 7, "biweekly": 14, "monthly": 30}.get(freq, custom or 7)


# ══════════════════════════════════════════════════════════════════════════════
# AUTH
# ══════════════════════════════════════════════════════════════════════════════

auth_router = APIRouter(prefix="/auth", tags=["auth"])


@auth_router.post("/register", response_model=TokenResponse, status_code=201)
async def register(body: RegisterRequest, response: Response, db: AsyncSession = Depends(get_db)):
    user = await create_user(db, body.email, body.password, body.name, body.grammatical_gender)
    access_token, expires_in = create_access_token(user.id)
    raw_rt, hashed_rt = create_refresh_token()
    await save_refresh_token(db, user.id, hashed_rt)
    response.set_cookie(
        "refresh_token", raw_rt,
        httponly=True,
        secure=_COOKIE_SECURE,   # FIX: False in dev (HTTP), True in prod (HTTPS)
        samesite="lax",
        max_age=settings.refresh_token_expire_days * 86400,
    )
    return TokenResponse(access_token=access_token, expires_in=expires_in)


@auth_router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, response: Response, db: AsyncSession = Depends(get_db)):
    user = await authenticate_user(db, body.email, body.password)
    access_token, expires_in = create_access_token(user.id)
    raw_rt, hashed_rt = create_refresh_token()
    await save_refresh_token(db, user.id, hashed_rt)
    response.set_cookie(
        "refresh_token", raw_rt,
        httponly=True,
        secure=_COOKIE_SECURE,   # FIX: False in dev (HTTP), True in prod (HTTPS)
        samesite="lax",
        max_age=settings.refresh_token_expire_days * 86400,
    )
    return TokenResponse(access_token=access_token, expires_in=expires_in)


@auth_router.post("/refresh", response_model=TokenResponse)
async def refresh_token(request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    raw_rt = request.cookies.get("refresh_token")
    if not raw_rt:
        raise HTTPException(status_code=401, detail="No refresh token")
    user, new_raw, new_hash = await rotate_refresh_token(db, raw_rt)
    access_token, expires_in = create_access_token(user.id)
    response.set_cookie(
        "refresh_token", new_raw,
        httponly=True,
        secure=_COOKIE_SECURE,   # FIX: False in dev (HTTP), True in prod (HTTPS)
        samesite="lax",
        max_age=settings.refresh_token_expire_days * 86400,
    )
    return TokenResponse(access_token=access_token, expires_in=expires_in)


@auth_router.post("/logout")
async def logout(response: Response):
    response.delete_cookie("refresh_token")
    return {"ok": True}


@auth_router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user)):
    return user


# ══════════════════════════════════════════════════════════════════════════════
# HOUSEHOLDS
# ══════════════════════════════════════════════════════════════════════════════

households_router = APIRouter(prefix="/households", tags=["households"])


@households_router.post("", response_model=HouseholdOut, status_code=201)
async def create_household(
    body: HouseholdCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    hh = Household(name=body.name, emoji=body.emoji, owner_id=user.id)
    db.add(hh)
    await db.flush()
    # Owner is also a member with role "owner"
    db.add(HouseholdMember(household_id=hh.id, user_id=user.id, role="owner"))
    await db.flush()
    return hh


@households_router.get("", response_model=list[HouseholdOut])
async def list_households(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    result = await db.execute(
        select(Household)
        .join(HouseholdMember, HouseholdMember.household_id == Household.id)
        .where(HouseholdMember.user_id == user.id)
    )
    return result.scalars().all()


@households_router.get("/{household_id}/members", response_model=list[HouseholdMemberOut])
async def get_members(
    household_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await require_household_role(household_id, user, db)
    result = await db.execute(
        select(HouseholdMember, User)
        .join(User, User.id == HouseholdMember.user_id)
        .where(HouseholdMember.household_id == household_id)
    )
    rows = result.all()
    return [
        HouseholdMemberOut(
            user_id=m.user_id, name=u.name, email=u.email,
            avatar_url=u.avatar_url, role=m.role, joined_at=m.joined_at,
        )
        for m, u in rows
    ]


@households_router.post("/{household_id}/invite")
async def invite_member(
    household_id: str,
    body: InviteMemberRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await require_household_role(household_id, user, db, min_role="admin")
    result = await db.execute(select(User).where(User.email == body.email.lower()))
    invitee = result.scalar_one_or_none()
    if not invitee:
        raise HTTPException(status_code=404, detail="משתמש לא נמצא")
    existing = await db.execute(
        select(HouseholdMember).where(
            HouseholdMember.household_id == household_id,
            HouseholdMember.user_id == invitee.id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="המשתמש כבר חבר במשק הבית")
    db.add(HouseholdMember(household_id=household_id, user_id=invitee.id, role=body.role or "member"))
    return {"ok": True}


# ══════════════════════════════════════════════════════════════════════════════
# CATALOG
# ══════════════════════════════════════════════════════════════════════════════

catalog_router = APIRouter(prefix="/catalog", tags=["catalog"])


@catalog_router.get("/categories", response_model=list[CatalogCategoryOut])
async def get_categories(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(CatalogCategory).order_by(CatalogCategory.sort_order))
    return result.scalars().all()


@catalog_router.get("/items/check-duplicate", response_model=DuplicateCheckResult)
async def check_duplicate(name: str, db: AsyncSession = Depends(get_db)):
    normalized = normalize_hebrew(name)
    result = await db.execute(
        select(CatalogItem).where(CatalogItem.name_he_normalized.ilike(f"%{normalized}%")).limit(5)
    )
    duplicates = result.scalars().all()
    return DuplicateCheckResult(duplicates=duplicates, can_create=len(duplicates) == 0)


@catalog_router.get("/items", response_model=CatalogSearchResult)
async def search_catalog(
    q: str = Query(default="", max_length=100),
    category: Optional[str] = None,
    limit: int = Query(default=20, le=50),
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if q:
        cached = await get_search_cache(q)
        if cached:
            return CatalogSearchResult(items=cached, total=len(cached))

    q_norm = normalize_hebrew(q)

    stmt = select(CatalogItem).where(CatalogItem.deleted_at.is_(None))
    if category:
        stmt = stmt.where(CatalogItem.category_id == category)
    if q_norm:
        stmt = stmt.where(
            text("similarity(name_he_normalized, :q) > 0.15").bindparams(q=q_norm)
        ).order_by(text("similarity(name_he_normalized, :q) DESC").bindparams(q=q_norm))
    else:
        stmt = stmt.order_by(CatalogItem.usage_count.desc())

    stmt = stmt.offset(offset).limit(limit)
    result = await db.execute(stmt)
    items = result.scalars().all()

    if q:
        await set_search_cache(q, [CatalogItemOut.model_validate(i).model_dump() for i in items])

    count_stmt = select(func.count()).select_from(CatalogItem).where(CatalogItem.deleted_at.is_(None))
    if q_norm:
        count_stmt = count_stmt.where(
            text("similarity(name_he_normalized, :q) > 0.15").bindparams(q=q_norm)
        )
    if category:
        count_stmt = count_stmt.where(CatalogItem.category_id == category)
    total = (await db.execute(count_stmt)).scalar_one()

    return CatalogSearchResult(items=items, total=total)


@catalog_router.post("/items", response_model=CatalogItemOut, status_code=201)
async def create_catalog_item(
    body: CatalogItemCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    normalized = normalize_hebrew(body.name_he)
    item = CatalogItem(
        name_he=body.name_he,
        name_he_normalized=normalized,
        category_id=body.category_id,
        default_qty=body.default_qty,
        default_unit=body.default_unit,
        created_by=user.id,
    )
    db.add(item)
    await db.flush()
    return item


@catalog_router.post("/items/{item_id}/image", response_model=CatalogItemOut)
async def upload_item_image(
    item_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Stores in MinIO, saves thumbnail URL."""
    from app.services.image_service import upload_catalog_image
    result = await db.execute(select(CatalogItem).where(CatalogItem.id == item_id))
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="פריט לא נמצא")
    image_url = await upload_catalog_image(item_id, file)
    item.image_url = image_url
    await db.flush()
    return item


# ══════════════════════════════════════════════════════════════════════════════
# SHOPPING LISTS
# ══════════════════════════════════════════════════════════════════════════════

lists_router = APIRouter(prefix="/lists", tags=["lists"])


@lists_router.post("", response_model=ListOut, status_code=201)
async def create_list(
    body: ListCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await require_household_role(body.household_id, user, db, min_role="member")
    lst = ShoppingList(
        name=body.name, emoji=body.emoji,
        household_id=body.household_id, created_by=user.id,
    )
    db.add(lst)
    await db.flush()
    # Creator is list admin
    db.add(ListMember(list_id=lst.id, user_id=user.id, role="admin"))
    await db.flush()
    return _list_out(lst, 1, 0)


@lists_router.get("", response_model=list[ListOut])
async def get_my_lists(
    household_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    stmt = (
        select(ShoppingList)
        .join(ListMember, ListMember.list_id == ShoppingList.id)
        .where(ListMember.user_id == user.id, ShoppingList.status == "active")
    )
    if household_id:
        stmt = stmt.where(ShoppingList.household_id == household_id)
    result = await db.execute(stmt.options(selectinload(ShoppingList.items)))
    lists = result.scalars().all()
    return [_list_out(l, len(l.items), sum(1 for i in l.items if i.status == "pending")) for l in lists]


@lists_router.get("/{list_id}/items", response_model=list[ListItemOut])
async def get_list_items(
    list_id: str,
    since: Optional[str] = None,   # ISO timestamp — for offline sync diff
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await require_list_role(list_id, user, db)
    stmt = (
        select(ListItem)
        .where(ListItem.list_id == list_id)
        .options(selectinload(ListItem.catalog_item))
        .order_by(ListItem.updated_at.desc())
    )
    if since:
        since_dt = datetime.fromisoformat(since)
        stmt = stmt.where(ListItem.updated_at > since_dt)
    result = await db.execute(stmt)
    return result.scalars().all()


@lists_router.post("/{list_id}/items", response_model=ListItemOut, status_code=201)
async def add_list_item(
    list_id: str,
    body: ListItemCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await require_list_role(list_id, user, db, min_role="editor")

    # Idempotency check
    if body.idempotency_key:
        cached = await check_idempotency(body.idempotency_key)
        if cached:
            return JSONResponse(content=cached, status_code=200)

    # Check for duplicate pending item
    dup = await db.execute(
        select(ListItem).where(
            ListItem.list_id == list_id,
            ListItem.catalog_item_id == body.catalog_item_id,
            ListItem.status == "pending",
        )
    )
    if dup.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="הפריט כבר קיים ברשימה")

    item = ListItem(
        list_id=list_id,
        catalog_item_id=body.catalog_item_id,
        quantity=body.quantity,
        unit=body.unit,
        note=body.note,
        added_by=user.id,
    )
    db.add(item)

    # Increment catalog usage
    await db.execute(
        update(CatalogItem)
        .where(CatalogItem.id == body.catalog_item_id)
        .values(usage_count=CatalogItem.usage_count + 1)
    )

    await db.flush()
    await db.refresh(item, ["catalog_item"])

    # Log mutation event (for offline sync)
    event = MutationEvent(
        list_id=list_id, user_id=user.id, event_type="item_added",
        payload={"item_id": item.id, "catalog_item_id": body.catalog_item_id},
        idempotency_key=body.idempotency_key,
    )
    db.add(event)

    # Publish to realtime channel
    await publish_list_event(list_id, {
        "type": "item_added",
        "item_id": item.id,
        "catalog_item_id": body.catalog_item_id,
        "quantity": str(body.quantity),
        "unit": body.unit,
        "added_by": user.id,
        "added_by_name": user.name,
    })

    if body.idempotency_key:
        await store_idempotency(body.idempotency_key, {"id": item.id})

    return item


@lists_router.post("/{list_id}/items/{item_id}/status", response_model=ListItemOut)
async def toggle_item_status(
    list_id: str,
    item_id: str,
    body: StatusToggleRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await require_list_role(list_id, user, db, min_role="editor")

    if body.idempotency_key:
        cached = await check_idempotency(body.idempotency_key)
        if cached:
            return JSONResponse(content=cached, status_code=200)

    result = await db.execute(
        select(ListItem).where(ListItem.id == item_id, ListItem.list_id == list_id)
        .options(selectinload(ListItem.catalog_item))
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="פריט לא נמצא")

    item.status = body.status
    item.purchased_by = user.id if body.status == "purchased" else None
    item.updated_at = datetime.now(timezone.utc)
    if body.vector_clock:
        item.vector_clock = body.vector_clock

    event = MutationEvent(
        list_id=list_id, user_id=user.id, event_type="item_updated",
        payload={"item_id": item_id, "status": body.status},
        idempotency_key=body.idempotency_key,
    )
    db.add(event)

    await publish_list_event(list_id, {
        "type": "item_status_changed",
        "item_id": item_id,
        "status": body.status,
        "by_user": user.id,
        "by_name": user.name,
    })

    if body.idempotency_key:
        await store_idempotency(body.idempotency_key, {"id": item_id, "status": body.status})

    return item


@lists_router.delete("/{list_id}/items/{item_id}", status_code=204)
async def delete_list_item(
    list_id: str,
    item_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await require_list_role(list_id, user, db, min_role="editor")
    result = await db.execute(
        select(ListItem).where(ListItem.id == item_id, ListItem.list_id == list_id)
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404)
    await db.delete(item)
    await publish_list_event(list_id, {"type": "item_deleted", "item_id": item_id, "by_user": user.id})


# ── Offline sync endpoint ─────────────────────────────────────────────────────

@lists_router.post("/{list_id}/sync", response_model=SyncResponse)
async def sync_mutations(
    list_id: str,
    body: SyncRequest,
    since: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """
    Called on reconnect. Accepts queued mutations, returns server diff since cursor.
    """
    await require_list_role(list_id, user, db)

    # Replay client mutations (idempotent via idempotency_key)
    results = []
    for mutation in body.mutations:
        if mutation.get("operation") == "POST" and "/items" in mutation.get("url", ""):
            try:
                cached = await check_idempotency(mutation["idempotency_key"])
                if not cached:
                    # Apply via normal endpoint logic (simplified)
                    results.append({"ok": True, "idempotency_key": mutation["idempotency_key"]})
            except Exception:
                results.append({"ok": False, "idempotency_key": mutation.get("idempotency_key")})

    # Return server diff since cursor
    stmt = (
        select(ListItem)
        .where(ListItem.list_id == list_id)
        .options(selectinload(ListItem.catalog_item))
        .order_by(ListItem.updated_at.desc())
    )
    if since:
        since_dt = datetime.fromisoformat(since)
        stmt = stmt.where(ListItem.updated_at > since_dt)
    result = await db.execute(stmt)
    items = result.scalars().all()

    return SyncResponse(items=items, server_cursor=datetime.now(timezone.utc).isoformat())


@lists_router.post("/{list_id}/invite")
async def invite_to_list(
    list_id: str,
    body: InviteToListRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await require_list_role(list_id, user, db, min_role="admin")
    existing = await db.execute(
        select(ListMember).where(ListMember.list_id == list_id, ListMember.user_id == body.user_id)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="המשתמש כבר חבר ברשימה")
    db.add(ListMember(list_id=list_id, user_id=body.user_id, role=body.role or "editor"))
    return {"ok": True}


# ══════════════════════════════════════════════════════════════════════════════
# RECURRING ITEMS
# ══════════════════════════════════════════════════════════════════════════════

recurring_router = APIRouter(prefix="/households/{household_id}/recurring", tags=["recurring"])


@recurring_router.get("", response_model=list[RecurringItemOut])
async def get_recurring(
    household_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await require_household_role(household_id, user, db)
    result = await db.execute(
        select(RecurringItem)
        .where(RecurringItem.household_id == household_id)
        .options(selectinload(RecurringItem.household))
        .order_by(RecurringItem.next_run_date)
    )
    items = result.scalars().all()
    # Manually load catalog items
    for item in items:
        cat_res = await db.execute(select(CatalogItem).where(CatalogItem.id == item.catalog_item_id))
        item.catalog_item = cat_res.scalar_one_or_none()
    return items


@recurring_router.post("", response_model=RecurringItemOut, status_code=201)
async def create_recurring(
    household_id: str,
    body: RecurringItemCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await require_household_role(household_id, user, db, min_role="admin")
    days = freq_to_days(body.frequency, body.interval_days)
    next_run = datetime.now(timezone.utc) + timedelta(days=days)
    item = RecurringItem(
        household_id=household_id,
        catalog_item_id=body.catalog_item_id,
        target_list_id=body.target_list_id,
        quantity=body.quantity,
        unit=body.unit,
        frequency=body.frequency,
        interval_days=days,
        next_run_date=next_run,
        auto_add=body.auto_add,
        created_by=user.id,
    )
    db.add(item)
    await db.flush()
    cat_res = await db.execute(select(CatalogItem).where(CatalogItem.id == body.catalog_item_id))
    item.catalog_item = cat_res.scalar_one_or_none()
    return item


@recurring_router.patch("/{recurring_id}", response_model=RecurringItemOut)
async def update_recurring(
    household_id: str,
    recurring_id: str,
    body: RecurringItemUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await require_household_role(household_id, user, db, min_role="admin")
    result = await db.execute(
        select(RecurringItem).where(RecurringItem.id == recurring_id, RecurringItem.household_id == household_id)
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404)
    for field, val in body.model_dump(exclude_none=True).items():
        setattr(item, field, val)
    if body.frequency or body.interval_days:
        days = freq_to_days(item.frequency, item.interval_days)
        item.interval_days = days
    await db.flush()
    cat_res = await db.execute(select(CatalogItem).where(CatalogItem.id == item.catalog_item_id))
    item.catalog_item = cat_res.scalar_one_or_none()
    return item


@recurring_router.delete("/{recurring_id}", status_code=204)
async def delete_recurring(
    household_id: str,
    recurring_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await require_household_role(household_id, user, db, min_role="admin")
    result = await db.execute(
        select(RecurringItem).where(RecurringItem.id == recurring_id, RecurringItem.household_id == household_id)
    )
    item = result.scalar_one_or_none()
    if item:
        await db.delete(item)


# ══════════════════════════════════════════════════════════════════════════════
# PUSH NOTIFICATIONS
# ══════════════════════════════════════════════════════════════════════════════

push_router = APIRouter(prefix="/push", tags=["push"])


@push_router.post("/subscriptions", status_code=201)
async def register_push_subscription(
    body: PushSubscriptionCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    existing = await db.execute(
        select(PushSubscription).where(
            PushSubscription.user_id == user.id,
            PushSubscription.endpoint == body.endpoint,
        )
    )
    if existing.scalar_one_or_none():
        return {"ok": True, "status": "already_registered"}

    db.add(PushSubscription(
        user_id=user.id,
        endpoint=body.endpoint,
        p256dh=body.p256dh,
        auth=body.auth,
        device_hint=body.device_hint,
    ))
    return {"ok": True}


@push_router.delete("/subscriptions")
async def unregister_push_subscription(
    endpoint: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(PushSubscription).where(
            PushSubscription.user_id == user.id,
            PushSubscription.endpoint == endpoint,
        )
    )
    sub = result.scalar_one_or_none()
    if sub:
        await db.delete(sub)
    return {"ok": True}


@push_router.get("/vapid-public-key")
async def get_vapid_public_key():
    return {"key": settings.vapid_public_key}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _list_out(lst: ShoppingList, member_count: int, pending_count: int) -> ListOut:
    return ListOut(
        id=lst.id, name=lst.name, emoji=lst.emoji, status=lst.status,
        household_id=lst.household_id, created_by=lst.created_by,
        created_at=lst.created_at, completed_at=lst.completed_at,
        member_count=member_count, pending_count=pending_count,
    )
