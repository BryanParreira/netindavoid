"""
AI router — supports Ollama, LM Studio (OpenAI-compat), OpenAI, Anthropic, and custom providers.
Config is stored in Redis so it persists without a restart.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
import httpx
import time
import json

from core.deps import get_current_user, get_db
from core.config import settings
from models.user import User
from models.ai_query import AiQueryLog

router = APIRouter(prefix="/ai", tags=["ai"])

SYSTEM_PROMPT = """You are the Vex AI assistant — an expert in home and small-business network security.
You help users understand network traffic, identify threats, investigate devices, and harden their network.
Be concise, practical, and direct. Use the context data provided when available.
Never invent specific IP addresses or MAC addresses that aren't in the provided context."""

# ── Config schema ─────────────────────────────────────────────────────────────

class AiConfig(BaseModel):
    provider: str = "ollama"          # ollama | lmstudio | openai | anthropic | custom
    ollama_url: str = "http://localhost:11434"
    ollama_model: str = "llama3.2"
    lmstudio_url: str = "http://localhost:1234"
    lmstudio_model: str = ""          # auto-detected from /v1/models
    openai_key: str = ""
    openai_model: str = "gpt-4o-mini"
    anthropic_key: str = ""
    anthropic_model: str = "claude-haiku-4-5-20251001"
    custom_url: str = ""
    custom_model: str = ""
    custom_key: str = ""


class AiQueryRequest(BaseModel):
    question: str
    context: Optional[dict] = None


class AiQueryResponse(BaseModel):
    answer: str
    model: str
    latency_ms: float


class ModelsResponse(BaseModel):
    provider: str
    models: List[str]


# ── Config persistence (Redis) ────────────────────────────────────────────────

REDIS_KEY = "ai:config"

async def _load_config() -> AiConfig:
    try:
        from core.redis import get_redis; r = get_redis()
        raw = await r.get(REDIS_KEY)
        if raw:
            return AiConfig.model_validate(json.loads(raw))
    except Exception:
        pass
    # Fallback: env vars
    return AiConfig(
        provider="ollama" if not settings.ANTHROPIC_API_KEY else "anthropic",
        ollama_url=settings.OLLAMA_BASE_URL,
        ollama_model=settings.OLLAMA_MODEL,
        anthropic_key=settings.ANTHROPIC_API_KEY,
    )


async def _save_config(cfg: AiConfig) -> None:
    try:
        from core.redis import get_redis; r = get_redis()
        await r.set(REDIS_KEY, cfg.model_dump_json())
    except Exception:
        pass


# ── Provider callers ──────────────────────────────────────────────────────────

def _build_user_content(question: str, context: Optional[dict]) -> str:
    if not context:
        return question
    return f"Network context:\n```json\n{json.dumps(context, indent=2)}\n```\n\nQuestion: {question}"


async def _call_ollama(cfg: AiConfig, question: str, context: Optional[dict]) -> tuple[str, str]:
    content = _build_user_content(question, context)
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            f"{cfg.ollama_url.rstrip('/')}/api/chat",
            json={
                "model": cfg.ollama_model,
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user",   "content": content},
                ],
                "stream": False,
            },
        )
        resp.raise_for_status()
        return resp.json()["message"]["content"], cfg.ollama_model


async def _call_openai_compat(base_url: str, api_key: str, model: str,
                               question: str, context: Optional[dict]) -> tuple[str, str]:
    content = _build_user_content(question, context)
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            f"{base_url.rstrip('/')}/v1/chat/completions",
            headers=headers,
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user",   "content": content},
                ],
                "max_tokens": 1024,
            },
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"], model


async def _call_anthropic(cfg: AiConfig, question: str, context: Optional[dict]) -> tuple[str, str]:
    content = _build_user_content(question, context)
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": cfg.anthropic_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": cfg.anthropic_model,
                "max_tokens": 1024,
                "system": SYSTEM_PROMPT,
                "messages": [{"role": "user", "content": content}],
            },
        )
        resp.raise_for_status()
        return resp.json()["content"][0]["text"], cfg.anthropic_model


async def _fetch_live_context(tenant_id: str, db: AsyncSession) -> dict:
    """Pull a rich live snapshot of network state to ground the AI answer."""
    from sqlalchemy import text
    tid = str(tenant_id)
    ctx: dict = {}
    try:
        # Devices
        r = await db.execute(text("""
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN status = 'online'  THEN 1 ELSE 0 END) AS online,
                SUM(CASE WHEN status = 'offline' THEN 1 ELSE 0 END) AS offline,
                SUM(CASE WHEN risk_score >= 70    THEN 1 ELSE 0 END) AS high_risk
            FROM devices WHERE tenant_id = :tid
        """), {"tid": tid})
        row = r.fetchone()
        ctx["devices"] = {
            "total": int(row[0] or 0), "online": int(row[1] or 0),
            "offline": int(row[2] or 0), "high_risk": int(row[3] or 0),
        }

        # High-risk device names
        if ctx["devices"]["high_risk"] > 0:
            r2 = await db.execute(text("""
                SELECT COALESCE(display_name, hostname, ip_address), risk_score, ip_address
                FROM devices WHERE tenant_id = :tid AND risk_score >= 70
                ORDER BY risk_score DESC LIMIT 5
            """), {"tid": tid})
            ctx["high_risk_devices"] = [
                {"name": row[0], "risk_score": row[1], "ip": row[2]}
                for row in r2.fetchall()
            ]

        # Open alerts last 24h
        r3 = await db.execute(text("""
            SELECT severity, COUNT(*) FROM alerts
            WHERE tenant_id = :tid AND status = 'open'
            AND triggered_at >= NOW() - INTERVAL '24 hours'
            GROUP BY severity ORDER BY severity
        """), {"tid": tid})
        ctx["open_alerts_by_severity"] = {row[0]: int(row[1]) for row in r3.fetchall()}

        # Recent critical/high alerts (titles)
        r4 = await db.execute(text("""
            SELECT title, severity, category, triggered_at::text
            FROM alerts
            WHERE tenant_id = :tid AND status = 'open'
            AND severity IN ('critical', 'high')
            AND triggered_at >= NOW() - INTERVAL '24 hours'
            ORDER BY triggered_at DESC LIMIT 8
        """), {"tid": tid})
        ctx["recent_critical_alerts"] = [
            {"title": row[0], "severity": row[1], "category": row[2], "when": row[3]}
            for row in r4.fetchall()
        ]

        # Malicious DNS (last 24h)
        r5 = await db.execute(text("""
            SELECT domain, COUNT(*) FROM dns_queries
            WHERE tenant_id = :tid AND is_malicious = true
            AND queried_at >= NOW() - INTERVAL '24 hours'
            GROUP BY domain ORDER BY COUNT(*) DESC LIMIT 10
        """), {"tid": tid})
        ctx["malicious_dns_domains"] = [row[0] for row in r5.fetchall()]

        # Current bandwidth (last 5 min)
        r6 = await db.execute(text("""
            SELECT
                COALESCE(SUM(bytes_in) / 300.0 * 8 / 1e6, 0),
                COALESCE(SUM(bytes_out) / 300.0 * 8 / 1e6, 0)
            FROM traffic_samples
            WHERE tenant_id = :tid AND sampled_at >= NOW() - INTERVAL '5 minutes'
        """), {"tid": tid})
        bw = r6.fetchone()
        ctx["bandwidth_mbps"] = {
            "download": round(float(bw[0] or 0), 2),
            "upload":   round(float(bw[1] or 0), 2),
        }

        # Top bandwidth consumers (last hour)
        r7 = await db.execute(text("""
            SELECT COALESCE(d.display_name, d.hostname, d.ip_address, 'unknown'),
                   SUM(ts.bytes_in + ts.bytes_out) AS total
            FROM traffic_samples ts
            LEFT JOIN devices d ON ts.device_id = d.id
            WHERE ts.tenant_id = :tid AND ts.sampled_at >= NOW() - INTERVAL '1 hour'
            AND ts.device_id IS NOT NULL
            GROUP BY d.display_name, d.hostname, d.ip_address
            ORDER BY total DESC LIMIT 5
        """), {"tid": tid})
        ctx["top_bandwidth_users"] = [
            {"name": row[0], "bytes": int(row[1])} for row in r7.fetchall()
        ]

    except Exception:
        pass
    return ctx


async def _call_provider(cfg: AiConfig, question: str, context: Optional[dict]) -> tuple[str, str]:
    if cfg.provider == "ollama":
        return await _call_ollama(cfg, question, context)
    elif cfg.provider == "lmstudio":
        model = cfg.lmstudio_model or "local-model"
        return await _call_openai_compat(cfg.lmstudio_url, "", model, question, context)
    elif cfg.provider == "openai":
        return await _call_openai_compat("https://api.openai.com", cfg.openai_key, cfg.openai_model, question, context)
    elif cfg.provider == "anthropic":
        return await _call_anthropic(cfg, question, context)
    elif cfg.provider == "custom":
        return await _call_openai_compat(cfg.custom_url, cfg.custom_key, cfg.custom_model, question, context)
    raise ValueError(f"Unknown provider: {cfg.provider}")


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/config", response_model=AiConfig)
async def get_config(user: User = Depends(get_current_user)):
    return await _load_config()


@router.post("/config", response_model=AiConfig)
async def save_config(body: AiConfig, user: User = Depends(get_current_user)):
    await _save_config(body)
    return body


@router.get("/models", response_model=ModelsResponse)
async def list_models(user: User = Depends(get_current_user)):
    cfg = await _load_config()
    models: List[str] = []
    try:
        if cfg.provider == "ollama":
            async with httpx.AsyncClient(timeout=8.0) as client:
                r = await client.get(f"{cfg.ollama_url.rstrip('/')}/api/tags")
                r.raise_for_status()
                models = [m["name"] for m in r.json().get("models", [])]
        elif cfg.provider == "lmstudio":
            async with httpx.AsyncClient(timeout=8.0) as client:
                r = await client.get(f"{cfg.lmstudio_url.rstrip('/')}/v1/models")
                r.raise_for_status()
                models = [m["id"] for m in r.json().get("data", [])]
        elif cfg.provider == "openai":
            models = ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"]
        elif cfg.provider == "anthropic":
            models = ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"]
    except Exception:
        pass
    return ModelsResponse(provider=cfg.provider, models=models)


@router.post("/query", response_model=AiQueryResponse)
async def ai_query(
    body: AiQueryRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    cfg = await _load_config()
    start = time.monotonic()

    # Always inject live network context; merge with any extra context from the client
    live_ctx = await _fetch_live_context(user.tenant_id, db)
    merged_ctx = {**live_ctx, **(body.context or {})}

    try:
        answer, model_used = await _call_provider(cfg, body.question, merged_ctx)
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"AI provider '{cfg.provider}' unavailable: {exc}",
        )

    latency_ms = (time.monotonic() - start) * 1000

    log = AiQueryLog(
        tenant_id=user.tenant_id,
        user_id=user.id,
        queried_at=datetime.now(timezone.utc),
        question=body.question,
        answer=answer,
        model_used=model_used,
        latency_ms=latency_ms,
    )
    db.add(log)
    await db.commit()

    return AiQueryResponse(answer=answer, model=model_used, latency_ms=round(latency_ms, 1))
