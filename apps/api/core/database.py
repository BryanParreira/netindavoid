from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import text
import structlog

from core.config import settings

logger = structlog.get_logger()

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.APP_ENV == "development",
    pool_pre_ping=True,
    pool_size=20,
    max_overflow=10,
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def _try_timescaledb() -> bool:
    """Enable TimescaleDB if available — runs in isolated transactions so failure never rolls back schema."""
    try:
        async with engine.begin() as conn:
            await conn.execute(text("CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;"))
        async with engine.begin() as conn:
            for table, col in [
                ("traffic_samples", "sampled_at"),
                ("dns_queries",     "queried_at"),
                ("log_events",      "timestamp"),
            ]:
                await conn.execute(text(f"""
                    SELECT create_hypertable('{table}', '{col}',
                        if_not_exists => TRUE, migrate_data => TRUE);
                """))
        async with engine.begin() as conn:
            for table in ["traffic_samples", "dns_queries", "log_events"]:
                await conn.execute(text(f"""
                    SELECT add_compression_policy('{table}',
                        INTERVAL '7 days', if_not_exists => TRUE);
                """))
        logger.info("TimescaleDB hypertables created")
        return True
    except Exception as e:
        logger.warning("TimescaleDB not available — running with plain PostgreSQL", error=str(e))
        return False


async def init_db() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await _try_timescaledb()
    logger.info("Database initialized")


async def check_db_health() -> bool:
    try:
        async with AsyncSessionLocal() as session:
            await session.execute(text("SELECT 1"))
        return True
    except Exception:
        return False
