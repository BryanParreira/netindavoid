"""MAC vendor lookup from IEEE OUI database."""
import re
from pathlib import Path
from functools import lru_cache
import httpx
import structlog

from core.config import settings

logger = structlog.get_logger()

_oui_map: dict[str, str] = {}


def _normalize_mac(mac: str) -> str:
    return re.sub(r"[^0-9a-fA-F]", "", mac).upper()[:6]


def load_oui_db(path: str | None = None) -> None:
    global _oui_map
    db_path = Path(path or settings.OUI_DB_PATH)
    if not db_path.exists():
        logger.warning("OUI database not found", path=str(db_path))
        return

    oui_map: dict[str, str] = {}
    with open(db_path, encoding="utf-8", errors="ignore") as f:
        for line in f:
            # Format: "00-00-00   (hex)   XEROX CORPORATION"
            match = re.match(r"^([0-9A-F]{2}-[0-9A-F]{2}-[0-9A-F]{2})\s+\(hex\)\s+(.+)$", line.strip())
            if match:
                prefix = match.group(1).replace("-", "")
                vendor = match.group(2).strip()
                oui_map[prefix] = vendor

    _oui_map = oui_map
    logger.info("OUI database loaded", entries=len(oui_map))


def lookup_vendor(mac: str) -> str | None:
    if not _oui_map:
        load_oui_db()
    prefix = _normalize_mac(mac)
    return _oui_map.get(prefix)


async def download_oui_db() -> None:
    """Download latest OUI database from IEEE if missing."""
    db_path = Path(settings.OUI_DB_PATH)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    url = "https://standards-oui.ieee.org/oui/oui.txt"
    logger.info("Downloading OUI database", url=url)
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            db_path.write_bytes(resp.content)
        load_oui_db()
        logger.info("OUI database downloaded")
    except Exception as e:
        logger.error("OUI download failed", error=str(e))
