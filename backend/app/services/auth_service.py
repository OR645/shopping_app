from datetime import datetime, timedelta, timezone
from typing import Optional
import hashlib
import secrets

from jose import jwt, JWTError
from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import HTTPException, status

from app.config import get_settings
from app.models.models import User, RefreshToken

settings = get_settings()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(user_id: str) -> tuple[str, int]:
    """Returns (token, expires_in_seconds)."""
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    payload = {"sub": user_id, "exp": expire, "type": "access"}
    token = jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    return token, settings.access_token_expire_minutes * 60


def create_refresh_token() -> tuple[str, str]:
    """Returns (raw_token, hashed_token)."""
    raw = secrets.token_urlsafe(48)
    hashed = hashlib.sha256(raw.encode()).hexdigest()
    return raw, hashed


def decode_access_token(token: str) -> Optional[str]:
    """Returns user_id or None if invalid."""
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        if payload.get("type") != "access":
            return None
        return payload.get("sub")
    except JWTError:
        return None


async def get_user_by_email(db: AsyncSession, email: str) -> Optional[User]:
    result = await db.execute(select(User).where(User.email == email.lower()))
    return result.scalar_one_or_none()


async def get_user_by_id(db: AsyncSession, user_id: str) -> Optional[User]:
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


async def create_user(db: AsyncSession, email: str, password: str, name: str, gender: str = "m") -> User:
    existing = await get_user_by_email(db, email)
    if existing:
        raise HTTPException(status_code=400, detail="כתובת האימייל כבר רשומה במערכת")

    user = User(
        email=email.lower(),
        name=name,
        password_hash=hash_password(password),
        grammatical_gender=gender,
    )
    db.add(user)
    await db.flush()
    return user


async def authenticate_user(db: AsyncSession, email: str, password: str) -> User:
    user = await get_user_by_email(db, email)
    if not user or not user.password_hash:
        raise HTTPException(status_code=401, detail="אימייל או סיסמה שגויים")
    if not verify_password(password, user.password_hash):
        raise HTTPException(status_code=401, detail="אימייל או סיסמה שגויים")
    return user


async def save_refresh_token(db: AsyncSession, user_id: str, token_hash: str, device_hint: str = "") -> None:
    expires = datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_expire_days)
    rt = RefreshToken(user_id=user_id, token_hash=token_hash, device_hint=device_hint, expires_at=expires)
    db.add(rt)
    await db.flush()


async def rotate_refresh_token(db: AsyncSession, raw_token: str, device_hint: str = "") -> tuple[User, str, str]:
    """Validate old refresh token, revoke it, issue new one. Returns (user, new_raw, new_hash)."""
    token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
    result = await db.execute(
        select(RefreshToken).where(
            RefreshToken.token_hash == token_hash,
            RefreshToken.revoked_at.is_(None),
            RefreshToken.expires_at > datetime.now(timezone.utc),
        )
    )
    rt = result.scalar_one_or_none()
    if not rt:
        raise HTTPException(status_code=401, detail="Refresh token invalid or expired")

    # Revoke old
    rt.revoked_at = datetime.now(timezone.utc)
    await db.flush()

    user = await get_user_by_id(db, rt.user_id)
    new_raw, new_hash = create_refresh_token()
    await save_refresh_token(db, user.id, new_hash, device_hint)
    return user, new_raw, new_hash


CREDENTIALS_EXCEPTION = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Not authenticated",
    headers={"WWW-Authenticate": "Bearer"},
)
