from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from app.config import get_settings
from app.models.database import async_engine
from app.models.models import Base
from app.routers.routers import (
    auth_router, households_router, catalog_router,
    lists_router, recurring_router, push_router,
)

settings = get_settings()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Startup ──────────────────────────────────────────────────────────────
    logger.info("Starting up Shopping App API...")

    # Create tables (in production use Alembic migrations)
    async with async_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Enable pg_trgm extension for Hebrew fuzzy search
        await conn.execute(
            __import__("sqlalchemy").text("CREATE EXTENSION IF NOT EXISTS pg_trgm;")
        )

    # Seed catalog categories if empty
    await _seed_categories()

    logger.info("API ready.")
    yield

    # ── Shutdown ─────────────────────────────────────────────────────────────
    await async_engine.dispose()
    logger.info("API shut down cleanly.")


app = FastAPI(
    title="קניות ביחד — API",
    description="Shared shopping list app for families. Hebrew-first, RTL, offline-capable.",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# ── Middleware ────────────────────────────────────────────────────────────────

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=1000)

# ── Routers ───────────────────────────────────────────────────────────────────

app.include_router(auth_router)
app.include_router(households_router)
app.include_router(catalog_router)
app.include_router(lists_router)
app.include_router(recurring_router)
app.include_router(push_router)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "api"}


# ── Catalog seeder ────────────────────────────────────────────────────────────

async def _seed_categories():
    from sqlalchemy import select
    from app.models.database import AsyncSessionLocal
    from app.models.models import CatalogCategory

    categories = [
        {"id": "veg",      "name_he": "ירקות ופירות",    "name_en": "Vegetables & Fruits", "icon": "🥦", "sort_order": 1},
        {"id": "dairy",    "name_he": "מוצרי חלב",       "name_en": "Dairy",               "icon": "🥛", "sort_order": 2},
        {"id": "meat",     "name_he": "בשר ודגים",       "name_en": "Meat & Fish",         "icon": "🥩", "sort_order": 3},
        {"id": "bakery",   "name_he": "מאפים ולחם",      "name_en": "Bakery",              "icon": "🍞", "sort_order": 4},
        {"id": "dry",      "name_he": "יבשים ושימורים",  "name_en": "Dry Goods",           "icon": "🥫", "sort_order": 5},
        {"id": "cleaning", "name_he": "ניקיון",           "name_en": "Cleaning",            "icon": "🧹", "sort_order": 6},
        {"id": "hygiene",  "name_he": "היגיינה",          "name_en": "Hygiene",             "icon": "🧴", "sort_order": 7},
        {"id": "frozen",   "name_he": "קפוא",             "name_en": "Frozen",              "icon": "🧊", "sort_order": 8},
        {"id": "other",    "name_he": "אחר",              "name_en": "Other",               "icon": "📦", "sort_order": 99},
    ]

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(CatalogCategory).limit(1))
        if result.scalar_one_or_none():
            return   # Already seeded

        for cat_data in categories:
            db.add(CatalogCategory(**cat_data))
        await db.commit()
        logger.info(f"Seeded {len(categories)} catalog categories")
