from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from pydantic_settings import BaseSettings
import httpx
from sqlalchemy import text
import structlog
import time

logger = structlog.get_logger()


class Settings(BaseSettings):
    OLLAMA_BASE_URL: str = "http://ollama:11434"
    OLLAMA_MODEL: str = "gemma4:12b"
    DATABASE_URL: str = ""


settings = Settings()
app = FastAPI(title="Netindavoid AI Service", version="1.0.0")

SYSTEM_PROMPT = """You are a network security assistant for Netindavoid, a home/small-business network monitoring platform.
You have access to live data from the user's network. Answer questions clearly and concisely in plain English.
Do not use jargon without explanation. When you see threats, explain what they mean and what the user should do.
Keep answers under 3 paragraphs unless a longer explanation is genuinely needed."""


class QueryRequest(BaseModel):
    question: str
    tenant_id: str
    context: dict = {}


class QueryResponse(BaseModel):
    answer: str
    model: str


async def _fetch_network_context(tenant_id: str) -> str:
    """Pull a compact snapshot of current network state for the LLM."""
    try:
        from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
        engine = create_async_engine(settings.DATABASE_URL)
        async_session = async_sessionmaker(engine, class_=AsyncSession)
        async with async_session() as db:
            # Device counts
            dev = await db.execute(text("""
                SELECT
                    COUNT(*) as total,
                    SUM(CASE WHEN status='online' THEN 1 ELSE 0 END) as online,
                    SUM(CASE WHEN status='offline' THEN 1 ELSE 0 END) as offline
                FROM devices WHERE tenant_id = :tid
            """), {"tid": tenant_id})
            dev_row = dev.fetchone()

            # Recent alerts
            alerts = await db.execute(text("""
                SELECT severity, COUNT(*) FROM alerts
                WHERE tenant_id = :tid AND status = 'open'
                AND triggered_at >= NOW() - INTERVAL '24 hours'
                GROUP BY severity
            """), {"tid": tenant_id})
            alert_rows = alerts.fetchall()

            # Bandwidth last 5 min
            bw = await db.execute(text("""
                SELECT
                    COALESCE(SUM(bytes_in)/300.0*8/1e6, 0) as mbps_in,
                    COALESCE(SUM(bytes_out)/300.0*8/1e6, 0) as mbps_out
                FROM traffic_samples
                WHERE tenant_id = :tid AND sampled_at >= NOW() - INTERVAL '5 minutes'
            """), {"tid": tenant_id})
            bw_row = bw.fetchone()

            # Top talker
            talker = await db.execute(text("""
                SELECT d.display_name, d.hostname, SUM(ts.bytes_out) as out
                FROM traffic_samples ts
                LEFT JOIN devices d ON ts.device_id = d.id
                WHERE ts.tenant_id = :tid AND ts.sampled_at >= NOW() - INTERVAL '1 hour'
                GROUP BY d.display_name, d.hostname
                ORDER BY out DESC LIMIT 1
            """), {"tid": tenant_id})
            talker_row = talker.fetchone()

        context = f"""CURRENT NETWORK STATE:
- Devices: {dev_row[0]} total, {dev_row[1]} online, {dev_row[2]} offline
- Open alerts (last 24h): {dict(alert_rows) if alert_rows else 'none'}
- Current bandwidth: {round(float(bw_row[0]), 2)} Mbps in / {round(float(bw_row[1]), 2)} Mbps out
- Top bandwidth user: {talker_row[0] or talker_row[1] or 'unknown' if talker_row else 'N/A'}"""
        return context
    except Exception as e:
        logger.warning("Context fetch failed", error=str(e))
        return "CURRENT NETWORK STATE: (data unavailable)"


@app.post("/query", response_model=QueryResponse)
async def query(body: QueryRequest):
    context = await _fetch_network_context(body.tenant_id)
    if body.context:
        context += f"\n\nADDITIONAL CONTEXT:\n{body.context}"

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": f"{context}\n\nUSER QUESTION: {body.question}"},
    ]

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                f"{settings.OLLAMA_BASE_URL}/api/chat",
                json={"model": settings.OLLAMA_MODEL,
                      "messages": messages, "stream": False},
            )
            resp.raise_for_status()
            data = resp.json()
            answer = data["message"]["content"]
    except httpx.RequestError as e:
        raise HTTPException(status_code=503, detail=f"Ollama unavailable: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return QueryResponse(answer=answer, model=settings.OLLAMA_MODEL)


@app.get("/health")
async def health():
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(f"{settings.OLLAMA_BASE_URL}/api/version")
            ollama_ok = r.status_code == 200
    except Exception:
        ollama_ok = False
    return {"status": "ok" if ollama_ok else "degraded", "ollama": ollama_ok}
