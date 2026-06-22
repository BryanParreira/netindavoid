"""
No-auth mode: single-user personal app, no login required.
All routes get a cached admin user automatically.
"""
from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from core.database import get_db
from models.user import User, UserRole

_cached_user: User | None = None


async def get_current_user(db: AsyncSession = Depends(get_db)) -> User:
    global _cached_user
    if _cached_user is not None:
        return _cached_user
    result = await db.execute(select(User).where(User.is_active == True).limit(1))
    user = result.scalar_one_or_none()
    if user:
        _cached_user = user
    else:
        # Fallback: create in-memory user object (no DB write needed for routes)
        user = User(role=UserRole.ADMIN)
    return user


async def require_admin(user: User = Depends(get_current_user)) -> User:
    return user


CurrentUser = Depends(get_current_user)
AdminUser   = Depends(require_admin)
DB          = Depends(get_db)
