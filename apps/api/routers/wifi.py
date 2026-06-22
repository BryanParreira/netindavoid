"""WiFi Intelligence endpoints — AP scanning, probe monitoring, deauth detection, rogue AP."""
from typing import Any
from fastapi import APIRouter, Depends, BackgroundTasks
from pydantic import BaseModel, Field

from core.deps import get_current_user
from models.user import User

router = APIRouter(prefix="/wifi", tags=["wifi"])


class ScanRequest(BaseModel):
    duration: int = Field(default=12, ge=5, le=60)
    known_aps: dict[str, str] = Field(default_factory=dict)


@router.get("/status")
async def wifi_status(user: User = Depends(get_current_user)) -> dict[str, Any]:
    """Check current connection + whether monitor mode is available."""
    from services.wifi_intel import current_connection, check_monitor_mode_available
    return {
        "current_connection": current_connection(),
        "monitor_mode_available": check_monitor_mode_available(),
        "interface": "en0",
    }


@router.post("/scan")
async def scan_wifi(
    body: ScanRequest,
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """
    Full WiFi intelligence scan.
    In monitor mode: APs (SSID/BSSID/channel/security/PHY), probe requests,
    deauth events, rogue AP detection.
    Without monitor mode: channel/security from system_profiler only.

    Note: Monitor mode briefly disconnects Wi-Fi (default 12 seconds).
    """
    from services.wifi_intel import wifi_scan
    return wifi_scan(body.duration, body.known_aps)


@router.get("/aps/quick")
async def quick_ap_scan(user: User = Depends(get_current_user)) -> dict[str, Any]:
    """Quick AP scan using system_profiler only (no monitor mode, no disconnect)."""
    from services.wifi_intel import scan_aps_sysprofile, current_connection
    return {
        "mode": "passive",
        "current_connection": current_connection(),
        "aps": scan_aps_sysprofile(),
    }
