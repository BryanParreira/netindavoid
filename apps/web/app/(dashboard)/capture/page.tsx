"use client";
import { useState, useRef, useEffect } from "react";
import useSWR from "swr";
import { api, WS_URL } from "@/lib/api";
import { TopBar } from "@/components/layout/TopBar";
import { cn } from "@/lib/utils";
import { Play, Square, Trash2, ChevronDown, Filter, Radio } from "lucide-react";
import toast from "react-hot-toast";

const fetcher = (url: string) => api.get(url).then((r) => r.data);

type Packet = {
  num:   number;
  time:  number;
  src:   string;
  dst:   string;
  proto: string;
  len:   number;
  info:  string;
  color: string;
};

const PROTO_CHIP: Record<string, string> = {
  TLS:     "text-purple-400 bg-purple-500/10 border-purple-500/30",
  HTTP:    "text-blue-400   bg-blue-500/10   border-blue-500/30",
  DNS:     "text-cyan-400   bg-cyan-500/10   border-cyan-500/30",
  SSH:     "text-amber-400  bg-amber-500/10  border-amber-500/30",
  ICMP:    "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
  ARP:     "text-yellow-400 bg-yellow-500/10 border-yellow-500/30",
  TCP:     "text-slate-300  bg-slate-500/10  border-slate-500/30",
  UDP:     "text-orange-400 bg-orange-500/10 border-orange-500/30",
  Unknown: "text-muted-foreground bg-muted   border-border",
};

const ROW_BG: Record<string, string> = {
  purple:  "bg-purple-500/5  hover:bg-purple-500/10",
  blue:    "bg-blue-500/5    hover:bg-blue-500/10",
  cyan:    "bg-cyan-500/5    hover:bg-cyan-500/10",
  amber:   "bg-amber-500/5   hover:bg-amber-500/10",
  green:   "bg-emerald-500/5 hover:bg-emerald-500/10",
  yellow:  "bg-yellow-500/5  hover:bg-yellow-500/10",
  default: "hover:bg-accent/20",
};

function ProtoBadge({ proto }: { proto: string }) {
  return (
    <span className={cn(
      "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
      PROTO_CHIP[proto] ?? PROTO_CHIP["Unknown"]
    )}>
      {proto}
    </span>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-2 text-xs">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className={cn("text-right break-all text-foreground", mono && "font-mono text-[10px]")}>{value}</span>
    </div>
  );
}

export default function CapturePage() {
  const [iface, setIface]           = useState("");
  const [bpfFilter, setBpf]         = useState("");
  const [maxCount, setMaxCount]     = useState(500);
  const [capturing, setCapturing]   = useState(false);
  const [packets, setPackets]       = useState<Packet[]>([]);
  const [selected, setSelected]     = useState<Packet | null>(null);
  const [protoFilter, setProtoFilter] = useState("all");
  const [autoScroll, setAutoScroll] = useState(true);
  const tableRef = useRef<HTMLDivElement>(null);
  const wsRef    = useRef<WebSocket | null>(null);

  const { data: ifacesData } = useSWR("/capture/interfaces", fetcher);
  const interfaces: string[] = ifacesData?.interfaces ?? [];

  useEffect(() => {
    if (autoScroll && tableRef.current) {
      tableRef.current.scrollTop = tableRef.current.scrollHeight;
    }
  }, [packets, autoScroll]);

  useEffect(() => () => { wsRef.current?.close(); }, []);

  const startCapture = () => {
    if (capturing) {
      wsRef.current?.close();
      setCapturing(false);
      return;
    }

    setPackets([]);
    setSelected(null);
    setCapturing(true);

    
    const params = new URLSearchParams({
      iface,
      filter:    bpfFilter,
      max_count: String(maxCount),
    });
    const ws = new WebSocket(`${WS_URL}/ws/capture?${params}`);
    wsRef.current = ws;

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.event === "packet") {
          const { event: _, ...pkt } = msg;
          setPackets((prev) => [...prev.slice(-2000), pkt as Packet]);
        } else if (msg.event === "error") {
          toast.error(msg.message);
          setCapturing(false);
        } else if (msg.event === "stopped") {
          setCapturing(false);
          toast.success("Capture complete");
        }
      } catch { /* ignore */ }
    };
    ws.onerror = () => { setCapturing(false); toast.error("Capture failed — check server permissions (root/CAP_NET_RAW required)"); };
    ws.onclose = () => { setCapturing(false); };
  };

  // Protocol breakdown
  const protoCounts: Record<string, number> = {};
  for (const p of packets) protoCounts[p.proto] = (protoCounts[p.proto] ?? 0) + 1;
  const topProtos = Object.entries(protoCounts).sort((a, b) => b[1] - a[1]).slice(0, 7);

  const visible = protoFilter === "all" ? packets : packets.filter((p) => p.proto === protoFilter);
  const t0 = packets[0]?.time ?? 0;

  return (
    <div className="flex flex-col overflow-hidden h-full">
      <TopBar title="Packet Capture" subtitle="Live protocol analyzer (Wireshark-style)" />

      <div className="flex-1 overflow-hidden flex flex-col p-5 gap-4 min-h-0">

        {/* ── Controls ── */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-44">
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Interface</label>
            <div className="relative">
              <select
                value={iface}
                onChange={(e) => setIface(e.target.value)}
                disabled={capturing}
                className="w-full appearance-none rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-50"
              >
                <option value="">All interfaces</option>
                {interfaces.map((i) => <option key={i} value={i}>{i}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            </div>
          </div>

          <div className="flex-1 min-w-52">
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">BPF Filter</label>
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              <input
                value={bpfFilter}
                onChange={(e) => setBpf(e.target.value)}
                placeholder="tcp port 80, not arp, host 10.0.0.1…"
                disabled={capturing}
                className="w-full rounded-md border border-border bg-background pl-8 pr-3 py-2 text-sm font-mono text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-50"
              />
            </div>
          </div>

          <div className="w-28">
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Max Pkts</label>
            <input
              type="number"
              value={maxCount}
              onChange={(e) => setMaxCount(Number(e.target.value))}
              min={10}
              max={5000}
              disabled={capturing}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-50"
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={startCapture}
              className={cn(
                "flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold transition-all",
                capturing
                  ? "bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20"
                  : "bg-brand-600 text-white hover:bg-brand-500 shadow-md shadow-brand-900/30"
              )}
            >
              {capturing
                ? <><Square className="h-3.5 w-3.5" />Stop</>
                : <><Play   className="h-3.5 w-3.5" />Capture</>
              }
            </button>
            <button
              onClick={() => { setPackets([]); setSelected(null); }}
              disabled={capturing || packets.length === 0}
              title="Clear"
              className="flex items-center gap-1.5 rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent disabled:opacity-30"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* ── Stats / proto filter bar ── */}
        <div className="flex flex-wrap items-center gap-2">
          <div className={cn(
            "flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium",
            capturing
              ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-400"
              : "border-border bg-muted text-muted-foreground"
          )}>
            {capturing && (
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
            )}
            <Radio className="h-3 w-3" />
            {capturing ? "Capturing" : "Stopped"} · {packets.length.toLocaleString()} pkts
          </div>

          {topProtos.map(([proto, count]) => (
            <button
              key={proto}
              onClick={() => setProtoFilter(protoFilter === proto ? "all" : proto)}
              className={cn(
                "flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[10px] font-semibold transition-all",
                protoFilter === proto
                  ? PROTO_CHIP[proto] ?? PROTO_CHIP["Unknown"]
                  : "border-border bg-muted text-muted-foreground hover:bg-accent"
              )}
            >
              {proto} <span className="font-mono opacity-60">{count}</span>
            </button>
          ))}

          {protoFilter !== "all" && (
            <button
              onClick={() => setProtoFilter("all")}
              className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              ✕ clear
            </button>
          )}

          <label className="ml-auto flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="h-3 w-3 accent-brand-500"
            />
            Auto-scroll
          </label>
        </div>

        {/* ── Packet table + detail ── */}
        <div className="flex-1 overflow-hidden grid grid-cols-1 xl:grid-cols-3 gap-4 min-h-0">

          {/* Table */}
          <div className="xl:col-span-2 flex flex-col rounded-xl border border-border bg-card overflow-hidden min-h-0">
            {/* Table header */}
            <div
              className="grid shrink-0 border-b border-border bg-muted/40 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
              style={{ gridTemplateColumns: "3rem 5.5rem 1fr 1fr 5rem 3.5rem" }}
            >
              <div className="px-3 py-2">No.</div>
              <div className="px-2 py-2">Time</div>
              <div className="px-2 py-2">Source</div>
              <div className="px-2 py-2">Destination</div>
              <div className="px-2 py-2">Protocol</div>
              <div className="px-2 py-2">Len</div>
            </div>
            <div ref={tableRef} className="flex-1 overflow-y-auto scrollbar-thin min-h-0">
              {visible.length === 0 ? (
                <div className="flex h-full items-center justify-center text-xs text-muted-foreground/40">
                  {capturing
                    ? "Waiting for packets…"
                    : packets.length === 0
                      ? "Click Capture to start"
                      : "No packets match filter"
                  }
                </div>
              ) : (
                visible.slice(-500).map((pkt) => (
                  <button
                    key={pkt.num}
                    onClick={() => setSelected(pkt)}
                    className={cn(
                      "w-full grid text-left border-b border-border/20 last:border-0 transition-colors",
                      ROW_BG[pkt.color] ?? ROW_BG["default"],
                      selected?.num === pkt.num && "ring-1 ring-inset ring-brand-500/50 bg-brand-500/5"
                    )}
                    style={{ gridTemplateColumns: "3rem 5.5rem 1fr 1fr 5rem 3.5rem" }}
                  >
                    <div className="px-3 py-1.5 font-mono text-[10px] text-muted-foreground">{pkt.num}</div>
                    <div className="px-2 py-1.5 font-mono text-[10px] text-muted-foreground">
                      {(pkt.time - t0).toFixed(3)}
                    </div>
                    <div className="px-2 py-1.5 font-mono text-[11px] truncate text-foreground">{pkt.src}</div>
                    <div className="px-2 py-1.5 font-mono text-[11px] truncate text-foreground">{pkt.dst}</div>
                    <div className="px-2 py-1.5"><ProtoBadge proto={pkt.proto} /></div>
                    <div className="px-2 py-1.5 font-mono text-[10px] text-muted-foreground">{pkt.len}</div>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Detail panel */}
          <div className="flex flex-col rounded-xl border border-border bg-card overflow-hidden min-h-0">
            <div className="border-b border-border px-4 py-2.5 shrink-0">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Packet Detail</span>
            </div>
            {selected ? (
              <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-3 min-h-0">
                <div className="rounded-md border border-border bg-background/40 p-3 space-y-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Frame</p>
                  <DetailRow label="No."      value={String(selected.num)} />
                  <DetailRow label="Time"     value={`+${(selected.time - t0).toFixed(6)}s`} mono />
                  <DetailRow label="Length"   value={`${selected.len} bytes`} />
                  <DetailRow label="Protocol" value={<ProtoBadge proto={selected.proto} />} />
                </div>
                <div className="rounded-md border border-border bg-background/40 p-3 space-y-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Network</p>
                  <DetailRow label="Source"      value={selected.src} mono />
                  <DetailRow label="Destination" value={selected.dst} mono />
                </div>
                <div className="rounded-md border border-border bg-background/40 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Info</p>
                  <p className="font-mono text-[11px] text-foreground break-all leading-relaxed">
                    {selected.info || "—"}
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground/40">
                Click a row to inspect
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
