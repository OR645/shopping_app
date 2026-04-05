from __future__ import annotations
from datetime import datetime
from decimal import Decimal
from typing import Optional, Any
from pydantic import BaseModel, EmailStr, Field, field_validator


# ── Auth ──────────────────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    name: str = Field(min_length=1, max_length=100)
    grammatical_gender: str = Field(default="m", pattern="^(m|f|neutral)$")


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int


class UserOut(BaseModel):
    id: str
    email: str
    name: str
    avatar_url: Optional[str] = None
    grammatical_gender: str = "m"
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Households ────────────────────────────────────────────────────────────────

class HouseholdCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    emoji: str = Field(default="🏠", max_length=10)


class HouseholdOut(BaseModel):
    id: str
    name: str
    emoji: str
    owner_id: str
    created_at: datetime

    model_config = {"from_attributes": True}


class HouseholdMemberOut(BaseModel):
    user_id: str
    name: str
    email: str
    avatar_url: Optional[str] = None
    role: str
    joined_at: datetime

    model_config = {"from_attributes": True}


class InviteMemberRequest(BaseModel):
    email: EmailStr
    role: str = Field(default="member", pattern="^(admin|member)$")


# ── Catalog ───────────────────────────────────────────────────────────────────

class CatalogCategoryOut(BaseModel):
    id: str
    name_he: str
    name_en: str
    icon: str
    sort_order: int

    model_config = {"from_attributes": True}


class CatalogItemCreate(BaseModel):
    name_he: str = Field(min_length=1, max_length=200)
    name_en: Optional[str] = None
    category_id: str
    default_qty: Decimal = Field(default=Decimal("1"), ge=0)
    default_unit: str = Field(default="יחידות", max_length=30)
    barcode: Optional[str] = None


class CatalogItemOut(BaseModel):
    id: str
    name_he: str
    name_en: Optional[str] = None
    category_id: str
    image_url: Optional[str] = None
    default_qty: Decimal
    default_unit: str
    barcode: Optional[str] = None
    usage_count: int = 0

    model_config = {"from_attributes": True}


class CatalogSearchResult(BaseModel):
    items: list[CatalogItemOut]
    total: int


class DuplicateCheckResult(BaseModel):
    duplicates: list[CatalogItemOut]
    can_create: bool


# ── Shopping Lists ────────────────────────────────────────────────────────────

class ListCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    emoji: str = Field(default="🛒", max_length=10)
    household_id: str


class ListOut(BaseModel):
    id: str
    name: str
    emoji: str
    status: str
    household_id: str
    created_by: str
    created_at: datetime
    completed_at: Optional[datetime] = None
    member_count: int = 0
    pending_count: int = 0

    model_config = {"from_attributes": True}


class ListMemberOut(BaseModel):
    user_id: str
    name: str
    role: str
    notification_prefs: dict[str, Any] = {}

    model_config = {"from_attributes": True}


class InviteToListRequest(BaseModel):
    user_id: str
    role: str = Field(default="editor", pattern="^(admin|editor|viewer)$")


# ── List Items ────────────────────────────────────────────────────────────────

class ListItemCreate(BaseModel):
    catalog_item_id: str
    quantity: Decimal = Field(default=Decimal("1"), ge=Decimal("0.1"))
    unit: str = Field(default="יחידות", max_length=30)
    note: Optional[str] = Field(default=None, max_length=300)
    idempotency_key: Optional[str] = Field(default=None, max_length=255)


class ListItemUpdate(BaseModel):
    quantity: Optional[Decimal] = None
    unit: Optional[str] = None
    note: Optional[str] = None
    status: Optional[str] = Field(default=None, pattern="^(pending|purchased)$")
    vector_clock: Optional[dict[str, int]] = None


class ListItemOut(BaseModel):
    id: str
    list_id: str
    catalog_item_id: str
    catalog_item: CatalogItemOut
    quantity: Decimal
    unit: str
    note: Optional[str] = None
    status: str
    added_by: Optional[str] = None
    purchased_by: Optional[str] = None
    vector_clock: dict[str, Any] = {}
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class StatusToggleRequest(BaseModel):
    status: str = Field(pattern="^(pending|purchased)$")
    vector_clock: dict[str, int] = {}
    idempotency_key: Optional[str] = None


# ── Recurring Items ───────────────────────────────────────────────────────────

class RecurringItemCreate(BaseModel):
    catalog_item_id: str
    target_list_id: Optional[str] = None
    quantity: Decimal = Field(default=Decimal("1"), ge=Decimal("0.1"))
    unit: str = Field(default="יחידות", max_length=30)
    frequency: str = Field(pattern="^(daily|weekly|biweekly|monthly|custom)$")
    interval_days: Optional[int] = Field(default=None, ge=1, le=365)
    auto_add: bool = True

    @field_validator("interval_days", mode="before")
    @classmethod
    def set_interval_from_frequency(cls, v, info):
        freq_map = {"daily": 1, "weekly": 7, "biweekly": 14, "monthly": 30}
        freq = info.data.get("frequency")
        if v is None and freq in freq_map:
            return freq_map[freq]
        return v


class RecurringItemOut(BaseModel):
    id: str
    household_id: str
    catalog_item_id: str
    catalog_item: CatalogItemOut
    target_list_id: Optional[str] = None
    quantity: Decimal
    unit: str
    frequency: str
    interval_days: int
    next_run_date: datetime
    auto_add: bool
    is_enabled: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class RecurringItemUpdate(BaseModel):
    quantity: Optional[Decimal] = None
    unit: Optional[str] = None
    frequency: Optional[str] = None
    interval_days: Optional[int] = None
    auto_add: Optional[bool] = None
    is_enabled: Optional[bool] = None
    target_list_id: Optional[str] = None


# ── Push Notifications ────────────────────────────────────────────────────────

class PushSubscriptionCreate(BaseModel):
    endpoint: str
    p256dh: str
    auth: str
    device_hint: Optional[str] = None


# ── Offline Sync ──────────────────────────────────────────────────────────────

class SyncRequest(BaseModel):
    """Client sends queued mutations accumulated while offline."""
    mutations: list[dict[str, Any]]


class SyncResponse(BaseModel):
    """Server returns diff of events since client's last cursor."""
    events: list[dict[str, Any]]
    server_cursor: str   # ISO timestamp of last processed event
