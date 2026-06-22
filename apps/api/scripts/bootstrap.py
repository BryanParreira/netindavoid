"""Creates the first admin user and tenant on startup if none exist."""
from sqlalchemy import select, func
import structlog

from core.config import settings
from core.database import AsyncSessionLocal
from core.security import hash_password
from models.user import User, UserRole
from models.tenant import Tenant

logger = structlog.get_logger()


async def bootstrap_admin() -> None:
    async with AsyncSessionLocal() as db:
        count_result = await db.execute(select(func.count(User.id)))
        if count_result.scalar() > 0:
            return  # already bootstrapped

        logger.info("Bootstrapping admin user", email=settings.ADMIN_EMAIL)

        slug = settings.ADMIN_TENANT_NAME.lower().replace(" ", "-")
        tenant = Tenant(name=settings.ADMIN_TENANT_NAME, slug=slug)
        db.add(tenant)
        await db.flush()

        user = User(
            tenant_id=tenant.id,
            email=settings.ADMIN_EMAIL,
            display_name="Admin",
            hashed_password=hash_password(settings.ADMIN_PASSWORD),
            role=UserRole.ADMIN,
        )
        db.add(user)
        await db.commit()
        logger.info("Admin user created", email=settings.ADMIN_EMAIL, tenant=settings.ADMIN_TENANT_NAME)
