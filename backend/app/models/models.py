import uuid
from datetime import datetime
from sqlalchemy import (
    Column, String, ForeignKey, Integer, Numeric,
    Boolean, DateTime, Text, Index, UniqueConstraint
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import DeclarativeBase, relationship
from sqlalchemy.sql import func


class Base(DeclarativeBase):
    pass


def gen_uuid():
    return str(uuid.uuid4())


# ── Users ─────────────────────────────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    email = Column(String(255), unique=True, nullable=False, index=True)
    name = Column(String(100), nullable=False)
    password_hash = Column(String(255), nullable=True)   # null for OAuth users
    avatar_url = Column(String(500), nullable=True)
    grammatical_gender = Column(String(10), default="m")  # m/f/neutral — for Hebrew notifications
    oauth_provider = Column(String(50), nullable=True)
    oauth_sub = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    last_active_at = Column(DateTime(timezone=True), server_default=func.now())

    household_memberships = relationship("HouseholdMember", back_populates="user", cascade="all, delete-orphan")
    list_memberships = relationship("ListMember", back_populates="user", cascade="all, delete-orphan")
    push_subscriptions = relationship("PushSubscription", back_populates="user", cascade="all, delete-orphan")
    refresh_tokens = relationship("RefreshToken", back_populates="user", cascade="all, delete-orphan")


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    user_id = Column(UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    token_hash = Column(String(255), unique=True, nullable=False, index=True)
    device_hint = Column(String(200), nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    revoked_at = Column(DateTime(timezone=True), nullable=True)

    user = relationship("User", back_populates="refresh_tokens")


# ── Households ────────────────────────────────────────────────────────────────

class Household(Base):
    __tablename__ = "households"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    name = Column(String(100), nullable=False)
    emoji = Column(String(10), default="🏠")
    owner_id = Column(UUID(as_uuid=False), ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    members = relationship("HouseholdMember", back_populates="household", cascade="all, delete-orphan")
    lists = relationship("ShoppingList", back_populates="household", cascade="all, delete-orphan")
    recurring_items = relationship("RecurringItem", back_populates="household", cascade="all, delete-orphan")


class HouseholdMember(Base):
    __tablename__ = "household_members"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    household_id = Column(UUID(as_uuid=False), ForeignKey("households.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    role = Column(String(20), nullable=False, default="member")  # owner | admin | member
    joined_at = Column(DateTime(timezone=True), server_default=func.now())

    household = relationship("Household", back_populates="members")
    user = relationship("User", back_populates="household_memberships")

    __table_args__ = (
        UniqueConstraint("household_id", "user_id"),
    )


# ── Catalog ───────────────────────────────────────────────────────────────────

class CatalogCategory(Base):
    __tablename__ = "catalog_categories"

    id = Column(String(50), primary_key=True)  # slug: "veg", "dairy", ...
    name_he = Column(String(100), nullable=False)
    name_en = Column(String(100), nullable=False)
    icon = Column(String(10), default="📦")
    sort_order = Column(Integer, default=99)

    items = relationship("CatalogItem", back_populates="category")


class CatalogItem(Base):
    __tablename__ = "catalog_items"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    name_he = Column(String(200), nullable=False)
    name_he_normalized = Column(String(200), nullable=False, index=True)  # for dedup
    name_en = Column(String(200), nullable=True)
    name_alt = Column(String(200), nullable=True)   # alternative/merged names
    category_id = Column(String(50), ForeignKey("catalog_categories.id"), nullable=False)
    image_url = Column(String(500), nullable=True)
    default_qty = Column(Numeric(10, 2), default=1)
    default_unit = Column(String(30), default="יחידות")
    barcode = Column(String(50), nullable=True, index=True)
    usage_count = Column(Integer, default=0)   # global popularity signal
    created_by = Column(UUID(as_uuid=False), ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    deleted_at = Column(DateTime(timezone=True), nullable=True)   # soft delete

    category = relationship("CatalogCategory", back_populates="items")
    list_items = relationship("ListItem", back_populates="catalog_item")

    __table_args__ = (
        Index("ix_catalog_items_trgm", "name_he_normalized", postgresql_using="gin",
              postgresql_ops={"name_he_normalized": "gin_trgm_ops"}),
    )


# ── Shopping Lists ────────────────────────────────────────────────────────────

class ShoppingList(Base):
    __tablename__ = "shopping_lists"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    household_id = Column(UUID(as_uuid=False), ForeignKey("households.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(100), nullable=False)
    emoji = Column(String(10), default="🛒")
    status = Column(String(20), default="active")  # active | archived | completed
    created_by = Column(UUID(as_uuid=False), ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    completed_at = Column(DateTime(timezone=True), nullable=True)

    household = relationship("Household", back_populates="lists")
    members = relationship("ListMember", back_populates="list", cascade="all, delete-orphan")
    items = relationship("ListItem", back_populates="list", cascade="all, delete-orphan")


class ListMember(Base):
    __tablename__ = "list_members"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    list_id = Column(UUID(as_uuid=False), ForeignKey("shopping_lists.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    role = Column(String(20), nullable=False, default="editor")  # admin | editor | viewer
    notification_prefs = Column(JSONB, default=lambda: {"item_added": True, "item_purchased": False})
    joined_at = Column(DateTime(timezone=True), server_default=func.now())

    list = relationship("ShoppingList", back_populates="members")
    user = relationship("User", back_populates="list_memberships")

    __table_args__ = (
        UniqueConstraint("list_id", "user_id"),
    )


class ListItem(Base):
    __tablename__ = "list_items"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    list_id = Column(UUID(as_uuid=False), ForeignKey("shopping_lists.id", ondelete="CASCADE"), nullable=False, index=True)
    catalog_item_id = Column(UUID(as_uuid=False), ForeignKey("catalog_items.id"), nullable=False)
    quantity = Column(Numeric(10, 2), nullable=False, default=1)
    unit = Column(String(30), nullable=False, default="יחידות")
    note = Column(String(300), nullable=True)
    status = Column(String(20), nullable=False, default="pending")  # pending | purchased
    added_by = Column(UUID(as_uuid=False), ForeignKey("users.id"), nullable=True)
    purchased_by = Column(UUID(as_uuid=False), ForeignKey("users.id"), nullable=True)
    vector_clock = Column(JSONB, default=lambda: {})    # {user_id: counter} for conflict resolution
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    list = relationship("ShoppingList", back_populates="items")
    catalog_item = relationship("CatalogItem", back_populates="list_items")

    __table_args__ = (
        # Idempotency: only one pending item per catalog item per list
        Index("ix_list_items_pending_unique", "list_id", "catalog_item_id",
              unique=True,
              postgresql_where="status = 'pending'"),
    )


# ── Recurring Items ───────────────────────────────────────────────────────────

class RecurringItem(Base):
    __tablename__ = "recurring_items"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    household_id = Column(UUID(as_uuid=False), ForeignKey("households.id", ondelete="CASCADE"), nullable=False, index=True)
    catalog_item_id = Column(UUID(as_uuid=False), ForeignKey("catalog_items.id"), nullable=False)
    target_list_id = Column(UUID(as_uuid=False), ForeignKey("shopping_lists.id"), nullable=True)
    quantity = Column(Numeric(10, 2), nullable=False, default=1)
    unit = Column(String(30), nullable=False, default="יחידות")
    frequency = Column(String(20), nullable=False, default="weekly")  # daily|weekly|biweekly|monthly|custom
    interval_days = Column(Integer, nullable=False, default=7)
    start_date = Column(DateTime(timezone=True), server_default=func.now())
    next_run_date = Column(DateTime(timezone=True), nullable=False, index=True)
    auto_add = Column(Boolean, default=True)
    is_enabled = Column(Boolean, default=True)
    created_by = Column(UUID(as_uuid=False), ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    household = relationship("Household", back_populates="recurring_items")


# ── Push notifications ────────────────────────────────────────────────────────

class PushSubscription(Base):
    __tablename__ = "push_subscriptions"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    user_id = Column(UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    endpoint = Column(Text, nullable=False)
    p256dh = Column(Text, nullable=False)
    auth = Column(Text, nullable=False)
    device_hint = Column(String(200), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    last_used_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", back_populates="push_subscriptions")

    __table_args__ = (
        UniqueConstraint("user_id", "endpoint"),
    )


# ── Mutation event log (for offline sync replay) ──────────────────────────────

class MutationEvent(Base):
    __tablename__ = "mutation_events"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    list_id = Column(UUID(as_uuid=False), ForeignKey("shopping_lists.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(UUID(as_uuid=False), ForeignKey("users.id"), nullable=False)
    event_type = Column(String(50), nullable=False)   # item_added | item_updated | item_deleted
    payload = Column(JSONB, nullable=False, default=dict)
    idempotency_key = Column(String(255), unique=True, nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    __table_args__ = (
        Index("ix_mutation_events_list_time", "list_id", "created_at"),
    )
