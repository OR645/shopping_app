#!/usr/bin/env python3
"""
Seed script — creates test data for development.

Usage:
  docker compose exec api python seed.py

Creates:
  User:      test@shopping.local / test1234
  Household: משפחת טסט
  List:      סופר שבועי (with sample items)
"""

import asyncio
import sys
import os

sys.path.insert(0, "/app")
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://postgres:secret@db:5432/shopping")
os.environ.setdefault("SYNC_DATABASE_URL", "postgresql://postgres:secret@db:5432/shopping")
os.environ.setdefault("REDIS_URL", "redis://redis:6379/0")
os.environ.setdefault("JWT_SECRET", "change-me-in-production-please")

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy import select, text
from app.models.models import Base
from app.models.models import (
    User, Household, HouseholdMember,
    ShoppingList, ListMember, ListItem,
    CatalogCategory, CatalogItem,
)
from app.services.auth_service import hash_password
from app.config import get_settings
import uuid

settings = get_settings()

engine = create_async_engine(settings.database_url, echo=False)
AsyncSessionLocal = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)


async def seed():
    # ── Create all tables first ───────────────────────────────────────────────
    print("Creating tables if they don't exist...")
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm;"))
        await conn.run_sync(Base.metadata.create_all)
    print("  ✓ Tables ready")

    async with AsyncSessionLocal() as db:

        # ── Check if already seeded ───────────────────────────────────────────
        existing = await db.execute(select(User).where(User.email == "test@shopping.local"))
        if existing.scalar_one_or_none():
            print("✓ Seed data already exists — skipping")
            print("\n  Email:    test@shopping.local")
            print("  Password: test1234\n")
            return

        print("Seeding test data...")

        # ── Seed categories if empty ──────────────────────────────────────────
        cat_check = await db.execute(select(CatalogCategory).limit(1))
        if not cat_check.scalar_one_or_none():
            categories = [
                CatalogCategory(id="veg",      name_he="ירקות ופירות",   name_en="Vegetables & Fruits", icon="🥦", sort_order=1),
                CatalogCategory(id="dairy",    name_he="מוצרי חלב",      name_en="Dairy",               icon="🥛", sort_order=2),
                CatalogCategory(id="meat",     name_he="בשר ודגים",      name_en="Meat & Fish",         icon="🥩", sort_order=3),
                CatalogCategory(id="bakery",   name_he="מאפים ולחם",     name_en="Bakery",              icon="🍞", sort_order=4),
                CatalogCategory(id="dry",      name_he="יבשים ושימורים", name_en="Dry Goods",           icon="🥫", sort_order=5),
                CatalogCategory(id="cleaning", name_he="ניקיון",          name_en="Cleaning",            icon="🧹", sort_order=6),
                CatalogCategory(id="hygiene",  name_he="היגיינה",         name_en="Hygiene",             icon="🧴", sort_order=7),
                CatalogCategory(id="frozen",   name_he="קפוא",            name_en="Frozen",              icon="🧊", sort_order=8),
                CatalogCategory(id="other",    name_he="אחר",             name_en="Other",               icon="📦", sort_order=99),
            ]
            for c in categories:
                db.add(c)
            await db.flush()
            print(f"  ✓ {len(categories)} categories")

        # ── Seed catalog items ────────────────────────────────────────────────
        def norm(s):
            return s.strip().lower()

        catalog_data = [
            ("חלב 3%",          "dairy",    2,   "ליטר"),
            ("גבינה לבנה 5%",   "dairy",    1,   "יחידות"),
            ("ביצים",           "dairy",    12,  "יחידות"),
            ("חמאה",            "dairy",    1,   "יחידות"),
            ("יוגורט",          "dairy",    3,   "יחידות"),
            ("עגבניות",         "veg",      1,   "ק\"ג"),
            ("מלפפון",          "veg",      3,   "יחידות"),
            ("פטרוזיליה",       "veg",      1,   "צרור"),
            ("כוסברה",          "veg",      1,   "צרור"),
            ("בצל",             "veg",      1,   "ק\"ג"),
            ("תפוח אדמה",       "veg",      1,   "ק\"ג"),
            ("לימון",           "veg",      3,   "יחידות"),
            ("גזר",             "veg",      500, "גרם"),
            ("חזה עוף",         "meat",     1,   "ק\"ג"),
            ("בשר טחון",        "meat",     500, "גרם"),
            ("לחם אחיד",        "bakery",   1,   "יחידות"),
            ("פיתות",           "bakery",   1,   "שקית"),
            ("שמן זית",         "dry",      1,   "בקבוק"),
            ("אורז",            "dry",      1,   "ק\"ג"),
            ("פסטה",            "dry",      1,   "חבילה"),
            ("קפה",             "dry",      1,   "חבילה"),
            ("סוכר",            "dry",      1,   "ק\"ג"),
            ("קמח",             "dry",      1,   "ק\"ג"),
            ("שוקולד",          "dry",      1,   "יחידות"),
            ("סבון כלים",       "cleaning", 1,   "בקבוק"),
            ("אבקת כביסה",      "cleaning", 1,   "חבילה"),
            ("נייר טואלט",      "hygiene",  1,   "חבילה"),
            ("שמפו",            "hygiene",  1,   "בקבוק"),
            ("נר הבדלה",        "other",    1,   "יחידות"),
            ("טונה",            "dry",      3,   "יחידות"),
        ]

        catalog_items = {}
        for name, cat_id, qty, unit in catalog_data:
            item = CatalogItem(
                id=str(uuid.uuid4()),
                name_he=name,
                name_he_normalized=norm(name),
                category_id=cat_id,
                default_qty=qty,
                default_unit=unit,
            )
            db.add(item)
            catalog_items[name] = item

        await db.flush()
        print(f"  ✓ {len(catalog_items)} catalog items")

        # ── Create test user ──────────────────────────────────────────────────
        user = User(
            id=str(uuid.uuid4()),
            email="test@shopping.local",
            name="משתמש טסט",
            password_hash=hash_password("test1234"),
            grammatical_gender="m",
        )
        db.add(user)
        await db.flush()
        print(f"  ✓ User: test@shopping.local / test1234")

        # ── Create household ──────────────────────────────────────────────────
        household = Household(
            id=str(uuid.uuid4()),
            name="משפחת טסט",
            emoji="🏠",
            owner_id=user.id,
        )
        db.add(household)
        await db.flush()

        db.add(HouseholdMember(
            id=str(uuid.uuid4()),
            household_id=household.id,
            user_id=user.id,
            role="owner",
        ))
        await db.flush()
        print(f"  ✓ Household: משפחת טסט")

        # ── Create shopping list ──────────────────────────────────────────────
        lst = ShoppingList(
            id=str(uuid.uuid4()),
            name="סופר שבועי",
            emoji="🛒",
            household_id=household.id,
            created_by=user.id,
            status="active",
        )
        db.add(lst)
        await db.flush()

        db.add(ListMember(
            id=str(uuid.uuid4()),
            list_id=lst.id,
            user_id=user.id,
            role="admin",
        ))
        await db.flush()

        # ── Add items to list ─────────────────────────────────────────────────
        list_items = [
            ("חלב 3%",        2,  "ליטר",    "pending"),
            ("ביצים",         12, "יחידות",  "pending"),
            ("לחם אחיד",      1,  "יחידות",  "pending"),
            ("עגבניות",       1,  "ק\"ג",    "pending"),
            ("גבינה לבנה 5%", 2,  "יחידות",  "pending"),
            ("פטרוזיליה",     1,  "צרור",    "pending"),
            ("קפה",           1,  "חבילה",   "purchased"),
            ("סוכר",          1,  "ק\"ג",    "purchased"),
        ]

        for item_name, qty, unit, status in list_items:
            cat_item = catalog_items.get(item_name)
            if not cat_item:
                continue
            db.add(ListItem(
                id=str(uuid.uuid4()),
                list_id=lst.id,
                catalog_item_id=cat_item.id,
                quantity=qty,
                unit=unit,
                status=status,
                added_by=user.id,
            ))

        await db.flush()
        print(f"  ✓ List: סופר שבועי ({len(list_items)} items)")

        await db.commit()

        print("\n" + "="*45)
        print("  Seed complete!")
        print("="*45)
        print(f"  URL:      http://localhost")
        print(f"  Email:    test@shopping.local")
        print(f"  Password: test1234")
        print("="*45 + "\n")


if __name__ == "__main__":
    asyncio.run(seed())
