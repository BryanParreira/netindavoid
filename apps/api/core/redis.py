import redis.asyncio as aioredis
from core.config import settings

_pool: aioredis.Redis | None = None


def get_redis() -> aioredis.Redis:
    """Shared command pool — do NOT use for pubsub."""
    global _pool
    if _pool is None:
        _pool = aioredis.from_url(
            settings.REDIS_URL,
            encoding="utf-8",
            decode_responses=True,
            max_connections=50,
        )
    return _pool


async def make_pubsub_client() -> aioredis.Redis:
    """Fresh dedicated client for one pubsub subscription. Caller must close it."""
    return aioredis.from_url(
        settings.REDIS_URL,
        encoding="utf-8",
        decode_responses=True,
        max_connections=1,
    )


async def publish_event(channel: str, payload: str) -> None:
    r = get_redis()
    await r.publish(channel, payload)


async def check_redis_health() -> bool:
    try:
        r = get_redis()
        return await r.ping()
    except Exception:
        return False
