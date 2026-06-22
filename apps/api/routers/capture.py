"""Packet capture — REST helpers. Live capture WebSocket lives in websocket.py."""
from fastapi import APIRouter, Depends

from core.deps import get_current_user
from models.user import User

router = APIRouter(prefix="/capture", tags=["capture"])


@router.get("/interfaces")
async def list_interfaces(user: User = Depends(get_current_user)):
    """List network interfaces available for packet capture."""
    try:
        from scapy.all import get_if_list
        ifaces = get_if_list()
    except Exception:
        ifaces = []
    return {"interfaces": ifaces}
