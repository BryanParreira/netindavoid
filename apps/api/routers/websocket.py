import asyncio
import json
import threading
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query

router = APIRouter(tags=["websocket"])


# ── No-auth bypass ────────────────────────────────────────────────────────────

async def _auth_ws(token: str | None = None) -> dict:
    return {"sub": "local", "tenant_id": "local"}


# ── Global pubsub multiplexer ─────────────────────────────────────────────────
# One Redis pubsub connection shared by all WS clients. Fanout via asyncio.Queue.

class PubSubBus:
    """Single Redis pubsub connection. Fanout messages to subscriber queues."""

    def __init__(self):
        self._subs: dict[str, list[asyncio.Queue]] = {}  # channel → queues
        self._task: asyncio.Task | None = None
        self._lock = asyncio.Lock()

    def subscribe(self, channel: str) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=100)
        self._subs.setdefault(channel, []).append(q)
        return q

    def unsubscribe(self, channel: str, q: asyncio.Queue) -> None:
        if channel in self._subs:
            try:
                self._subs[channel].remove(q)
            except ValueError:
                pass

    def _fanout(self, channel: str, message: str) -> None:
        dead = []
        for q in self._subs.get(channel, []):
            try:
                q.put_nowait(message)
            except asyncio.QueueFull:
                dead.append(q)
        for q in dead:
            self.unsubscribe(channel, q)

    async def start(self):
        """Launch background task that reads from Redis pubsub."""
        if self._task and not self._task.done():
            return
        self._task = asyncio.create_task(self._run())

    async def _run(self):
        from core.redis import get_redis
        r = get_redis()
        pubsub = r.pubsub()
        channels = ["traffic", "alerts", "devices", "logs"]
        try:
            await pubsub.subscribe(*channels)
            async for msg in pubsub.listen():
                if msg["type"] == "message":
                    ch = msg["channel"]
                    self._fanout(ch, msg["data"])
        except Exception:
            await asyncio.sleep(5)
            self._task = asyncio.create_task(self._run())  # reconnect
        finally:
            try:
                await pubsub.close()
            except Exception:
                pass


bus = PubSubBus()


# ── Connection manager (for broadcast from non-pubsub sources) ────────────────

class ConnectionManager:
    def __init__(self):
        self._connections: dict[str, list[WebSocket]] = {}

    async def connect(self, channel: str, ws: WebSocket) -> None:
        await ws.accept()
        self._connections.setdefault(channel, []).append(ws)

    def disconnect(self, channel: str, ws: WebSocket) -> None:
        if channel in self._connections:
            try:
                self._connections[channel].remove(ws)
            except ValueError:
                pass

    async def broadcast(self, channel: str, data: Any) -> None:
        msg = json.dumps(data) if not isinstance(data, str) else data
        dead = []
        for ws in self._connections.get(channel, []):
            try:
                await ws.send_text(msg)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(channel, ws)


manager = ConnectionManager()


# ── Helper: serve a pubsub channel over a WebSocket ──────────────────────────

async def _serve_pubsub(websocket: WebSocket, channel: str, message_filter=None):
    """Accept WS, subscribe to channel via bus, forward messages until disconnect."""
    await bus.start()
    q = bus.subscribe(channel)
    await websocket.accept()
    try:
        while True:
            try:
                raw = await asyncio.wait_for(q.get(), timeout=30)
            except asyncio.TimeoutError:
                try:
                    await websocket.send_json({"event": "ping"})
                except Exception:
                    break
                continue

            try:
                data = json.loads(raw) if isinstance(raw, str) else raw
            except Exception:
                data = {}

            if message_filter and not message_filter(data):
                continue

            try:
                await websocket.send_text(raw if isinstance(raw, str) else json.dumps(raw))
            except Exception:
                break

    except WebSocketDisconnect:
        pass
    finally:
        bus.unsubscribe(channel, q)
        try:
            await websocket.close()
        except Exception:
            pass


# ── WebSocket routes ──────────────────────────────────────────────────────────

@router.websocket("/ws/live-traffic")
async def ws_live_traffic(websocket: WebSocket, token: str | None = Query(None)):
    await _serve_pubsub(websocket, "traffic")


@router.websocket("/ws/alerts")
async def ws_alerts(websocket: WebSocket, token: str | None = Query(None)):
    await _serve_pubsub(websocket, "alerts")


@router.websocket("/ws/devices")
async def ws_devices(websocket: WebSocket, token: str | None = Query(None)):
    await _serve_pubsub(websocket, "devices")


@router.websocket("/ws/logs")
async def ws_logs(
    websocket:  WebSocket,
    token:      str = Query(None),
    index:      str = Query(""),
    sourcetype: str = Query(""),
    severity:   str = Query(""),
):
    def _filter(data: dict) -> bool:
        if index      and data.get("index")      != index:      return False
        if sourcetype and data.get("sourcetype") != sourcetype: return False
        if severity   and data.get("severity")   != severity:   return False
        return True

    await _serve_pubsub(websocket, "logs", message_filter=_filter if any([index, sourcetype, severity]) else None)


# ── Nmap scanner WebSocket ────────────────────────────────────────────────────

@router.websocket("/ws/nmap")
async def ws_nmap(
    websocket: WebSocket,
    scan_id:   str = Query(...),
    token:     str = Query(None),
):
    from routers.nmap_scanner import _scan_store, _parse_nmap_output, SCAN_PROFILES

    scan = _scan_store.get(scan_id)
    if not scan:
        await websocket.accept()
        await websocket.send_json({"event": "error", "message": "Scan not found"})
        await websocket.close()
        return

    if scan["status"] in ("completed", "error"):
        await websocket.accept()
        await websocket.send_json({
            "event":  "done",
            "hosts":  scan.get("hosts", []),
            "output": scan.get("output", []),
        })
        await websocket.close()
        return

    await websocket.accept()

    target  = scan["target"]
    profile = scan["profile"]
    args    = SCAN_PROFILES.get(profile, SCAN_PROFILES["quick"])["args"]
    scan["status"] = "running"

    async def _send(event: str, **kwargs: Any) -> None:
        try:
            await websocket.send_json({"event": event, **kwargs})
        except Exception:
            pass

    await _send("started", target=target, profile=profile, args=args)

    try:
        cmd = ["nmap"] + args.split() + [target]
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )

        output_lines: list[str] = []
        while True:
            raw = await proc.stdout.readline()
            if not raw:
                break
            text = raw.decode("utf-8", errors="replace").rstrip()
            output_lines.append(text)
            scan["output"] = output_lines
            await _send("line", text=text)

        await proc.wait()
        hosts = _parse_nmap_output("\n".join(output_lines))
        scan["hosts"]  = hosts
        scan["status"] = "completed"
        await _send("done", hosts=hosts, returncode=proc.returncode)

    except WebSocketDisconnect:
        scan["status"] = "disconnected"
    except Exception as exc:
        scan["status"] = "error"
        scan["error"]  = str(exc)
        await _send("error", message=str(exc))
    finally:
        try:
            await websocket.close()
        except Exception:
            pass


# ── Packet dissector ──────────────────────────────────────────────────────────

def _dissect_packet(pkt: Any, num: int) -> dict:
    result: dict = {
        "num":   num,
        "time":  float(pkt.time),
        "src":   "?",
        "dst":   "?",
        "proto": "Unknown",
        "len":   len(pkt),
        "info":  "",
        "color": "default",
    }

    try:
        from scapy.layers.l2   import ARP
        from scapy.layers.inet import IP, TCP, UDP, ICMP
        from scapy.layers.dns  import DNS

        if pkt.haslayer(ARP):
            arp = pkt[ARP]
            result.update({
                "src":   arp.psrc,
                "dst":   arp.pdst,
                "proto": "ARP",
                "color": "yellow",
                "info":  (f"Who has {arp.pdst}? Tell {arp.psrc}"
                          if arp.op == 1 else f"{arp.psrc} is at {arp.hwsrc}"),
            })
            return result

        if pkt.haslayer(IP):
            ip = pkt[IP]
            result["src"] = ip.src
            result["dst"] = ip.dst

            if pkt.haslayer(TCP):
                tcp = pkt[TCP]
                sport, dport = tcp.sport, tcp.dport
                result["src"] += f":{sport}"
                result["dst"] += f":{dport}"
                flags = str(tcp.flags)
                if 443 in (sport, dport):
                    result.update({"proto": "TLS",  "color": "purple"})
                elif 80 in (sport, dport):
                    result.update({"proto": "HTTP", "color": "blue"})
                elif 22 in (sport, dport):
                    result.update({"proto": "SSH",  "color": "amber"})
                else:
                    result["proto"] = "TCP"
                result["info"] = f"Seq={tcp.seq} [{flags}]"

            elif pkt.haslayer(UDP):
                udp = pkt[UDP]
                sport, dport = udp.sport, udp.dport
                result["src"] += f":{sport}"
                result["dst"] += f":{dport}"
                if pkt.haslayer(DNS):
                    dns = pkt[DNS]
                    result.update({"proto": "DNS", "color": "cyan"})
                    qname = dns.qd.qname.decode("utf-8", errors="replace") if dns.qd else "?"
                    result["info"] = f"{'Query' if dns.qr == 0 else 'Resp'} {qname}"
                else:
                    result["proto"] = "UDP"
                    result["info"]  = f"{sport}→{dport}"

            elif pkt.haslayer(ICMP):
                icmp = pkt[ICMP]
                result.update({"proto": "ICMP", "color": "green"})
                result["info"] = {
                    0: "Echo Reply", 8: "Echo Request", 3: "Dest Unreachable",
                }.get(icmp.type, f"Type={icmp.type}")

    except Exception:
        pass

    return result


# ── Packet capture WebSocket ──────────────────────────────────────────────────

@router.websocket("/ws/capture")
async def ws_capture(
    websocket:  WebSocket,
    token:      str = Query(None),
    iface:      str = Query(""),
    bpf_filter: str = Query("", alias="filter"),
    max_count:  int = Query(500),
):
    await websocket.accept()

    try:
        from scapy.all import sniff as scapy_sniff
    except ImportError:
        await websocket.send_json({"event": "error", "message": "scapy not available on this server"})
        await websocket.close()
        return

    loop      = asyncio.get_running_loop()
    queue: asyncio.Queue[dict] = asyncio.Queue()
    stop_evt  = threading.Event()
    counter   = [0]

    def _on_pkt(pkt: Any) -> None:
        n = counter[0]
        counter[0] += 1
        data = _dissect_packet(pkt, n)
        loop.call_soon_threadsafe(queue.put_nowait, {"event": "packet", **data})

    def _run_sniff() -> None:
        try:
            scapy_sniff(
                iface=iface or None,
                filter=bpf_filter or None,
                prn=_on_pkt,
                store=False,
                count=max_count,
                stop_filter=lambda _: stop_evt.is_set(),
            )
        except Exception as exc:
            loop.call_soon_threadsafe(
                queue.put_nowait, {"event": "error", "message": str(exc)}
            )
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, {"event": "stopped"})

    sniff_thread = threading.Thread(target=_run_sniff, daemon=True)
    sniff_thread.start()

    await websocket.send_json({
        "event":  "started",
        "iface":  iface or "all",
        "filter": bpf_filter or "none",
    })

    try:
        while True:
            try:
                msg = await asyncio.wait_for(queue.get(), timeout=1.0)
            except asyncio.TimeoutError:
                try:
                    await websocket.send_json({"event": "ping"})
                except Exception:
                    break
                continue

            await websocket.send_json(msg)
            if msg.get("event") in ("error", "stopped"):
                break

    except WebSocketDisconnect:
        pass
    finally:
        stop_evt.set()
        try:
            await websocket.close()
        except Exception:
            pass
        sniff_thread.join(timeout=3)
