from fastapi import Depends, HTTPException, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import get_db
from app.models.models import User, HouseholdMember, ListMember
from app.services.auth_service import decode_access_token, get_user_by_id, CREDENTIALS_EXCEPTION
from sqlalchemy import select

bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    if not credentials:
        raise CREDENTIALS_EXCEPTION
    user_id = decode_access_token(credentials.credentials)
    if not user_id:
        raise CREDENTIALS_EXCEPTION
    user = await get_user_by_id(db, user_id)
    if not user:
        raise CREDENTIALS_EXCEPTION
    return user


# ── Household role check ──────────────────────────────────────────────────────

ROLE_RANK = {"member": 1, "admin": 2, "owner": 3}


async def require_household_role(
    household_id: str,
    user: User,
    db: AsyncSession,
    min_role: str = "member",
) -> HouseholdMember:
    result = await db.execute(
        select(HouseholdMember).where(
            HouseholdMember.household_id == household_id,
            HouseholdMember.user_id == user.id,
        )
    )
    membership = result.scalar_one_or_none()
    if not membership:
        raise HTTPException(status_code=403, detail="אינך חבר במשק הבית הזה")
    if ROLE_RANK.get(membership.role, 0) < ROLE_RANK.get(min_role, 0):
        raise HTTPException(status_code=403, detail="אין לך הרשאה לפעולה זו")
    return membership


async def require_list_role(
    list_id: str,
    user: User,
    db: AsyncSession,
    min_role: str = "viewer",
) -> ListMember:
    result = await db.execute(
        select(ListMember).where(
            ListMember.list_id == list_id,
            ListMember.user_id == user.id,
        )
    )
    membership = result.scalar_one_or_none()
    if not membership:
        raise HTTPException(status_code=403, detail="אינך חבר ברשימה זו")

    list_role_rank = {"viewer": 1, "editor": 2, "admin": 3}
    if list_role_rank.get(membership.role, 0) < list_role_rank.get(min_role, 0):
        raise HTTPException(status_code=403, detail="אין לך הרשאה לפעולה זו")
    return membership
