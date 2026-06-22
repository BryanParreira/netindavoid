"use client";
import { useState, useRef, useEffect } from "react";
import useSWR from "swr";
import { api, WS_URL } from "@/lib/api";
import { TopBar } from "@/components/layout/TopBar";
import { cn } from "@/lib/utils";
import {
  Play, Square, Terminal, Server, Cpu, ChevronDown,
} from "lucide-react";
import toast from "react-hot-toast";

const fetcher = (url: string) => api.get(url).then((r) => r.data);

const STATE_COLORS: Record<string, string> = {
  open:     "text-emerald-400",
  filtered: "text-yellow-500",
  closed:   "text-zinc-500",
};

type Port = { port: number; proto: string; state: string; service: string; version: string };
type Host = { ip: string; hostname: string | null; status: string; os: string | null; ports: Port[] };
type ScanStatus = "idle" | "connecting" | "running" | "done" | "error";

function PortRow({ port, proto, state, service, version }: Port) {
  return (
    <div className="flex items-center gap-2 py-1.5 border-b border-border/40 last:border-0 text-xs">
      <span className="font-mono w-16 shrink-0 text-foreground">{port}/{proto}</span>
      <span className={cn("w-16 shrink-0 font-semibold", STATE_COLORS[state] ?? "text-muted-foreground")}>{state}</span>
      <span className="text-muted-foreground w-20 shrink-0">{service}</span>
      <span className="text-muted-foreground/60 truncate text-[10px]">{version}</span>
    </div>
  );
}

const STATUS_RING: Record<ScanStatus, string> = {
  idle:       "",
  connecting: "border-yellow-500/30 bg-yellow-500/5 text-yellow-400",
  running:    "border-brand-500/30 bg-brand-500/5 text-brand-400",
  done:       "border-emerald-500/30 bg-emerald-500/5 text-emerald-400",
  error:      "border-red-500/30 bg-red-500/5 text-red-400",
};

export default function ScannerPage() {
  const [target, setTarget]     = useState("192.168.1.0/24");
  const [profile, setProfile]   = useState("quick");
  const [scanStatus, setScanStatus] = useState<ScanStatus>("idle");
  const [lines, setLines]       = useState<string[]>([]);
  const [hosts, setHosts]       = useState<Host[]>([]);
  const [selected, setSelected] = useState<Host | null>(null);
  const termRef = useRef<HTMLDivElement>(null);
  const wsRef   = useRef<WebSocket | null>(null);

  const { data: profiles } = useSWR("/nmap/profiles", fetcher);

  useEffect(() => {
    if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight;
  }, [lines]);

  useEffect(() => () => { wsRef.current?.close(); }, []);

  const isRunning = scanStatus === "running" || scanStatus === "connecting";

  const handleScan = async () => {
    if (isRunning) {
      wsRef.current?.close();
      setScanStatus("idle");
      return;
    }

    setLines([]);
    setHosts([]);
    setSelected(null);
    setScanStatus("connecting");

    try {
      const { data } = await api.post("/nmap/scan", { target, profile });
      
      const ws = new WebSocket(
        `${WS_URL}/ws/nmap?scan_id=${encodeURIComponent(data.scan_id)}`
      );
      wsRef.current = ws;

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          switch (msg.event) {
            case "started":
              setScanStatus("running");
              setLines((prev) => [...prev, `$ nmap ${msg.args} ${msg.target}`, ""]);
              break;
            case "line":
              setLines((prev) => [...prev, msg.text]);
              break;
            case "done":
              setScanStatus("done");
              setHosts(msg.hosts ?? []);
              setLines((prev) => [...prev, "", `✓ Complete — ${(msg.hosts ?? []).length} host(s) found`]);
              break;
            case "error":
              setScanStatus("error");
              setLines((prev) => [...prev, `✗ ${msg.message}`]);
              toast.error(msg.message);
              break;
          }
        } catch { /* ignore parse errors */ }
      };
      ws.onerror = () => { setScanStatus("error"); toast.error("WebSocket error"); };
      ws.onclose = () => { setScanStatus((s) => s === "running" ? "done" : s); };
    } catch (err: any) {
      setScanStatus("error");
      toast.error(err.response?.data?.detail ?? "Failed to start scan");
    }
  };

  const profileMeta = (profiles ?? []).find((p: any) => p.id === profile);

  return (
    <div className="flex flex-col overflow-hidden h-full">
      <TopBar title="Nmap Scanner" subtitle="Port scanning & OS fingerprinting" />

      <div className="flex-1 overflow-hidden flex flex-col p-5 gap-4 min-h-0">

        {/* ── Controls ── */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-48">
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Target</label>
            <input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="192.168.1.0/24, hostname, or IP"
              disabled={isRunning}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-50"
            />
          </div>

          <div className="w-52">
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Profile</label>
            <div className="relative">
              <select
                value={profile}
                onChange={(e) => setProfile(e.target.value)}
                disabled={isRunning}
                className="w-full appearance-none rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-50"
              >
                {(profiles ?? []).map((p: any) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            </div>
          </div>

          {profileMeta && (
            <p className="hidden sm:block text-[10px] text-muted-foreground pb-2 max-w-48">{profileMeta.desc}</p>
          )}

          <button
            onClick={handleScan}
            className={cn(
              "flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold transition-all",
              isRunning
                ? "bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20"
                : "bg-brand-600 text-white hover:bg-brand-500 shadow-md shadow-brand-900/30"
            )}
          >
            {isRunning
              ? <><Square className="h-3.5 w-3.5" />Stop</>
              : <><Play  className="h-3.5 w-3.5" />Scan</>
            }
          </button>
        </div>

        {/* ── Status banner ── */}
        {scanStatus !== "idle" && (
          <div className={cn("flex items-center gap-2 rounded-lg border px-4 py-2 text-xs", STATUS_RING[scanStatus])}>
            {isRunning && (
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-current" />
              </span>
            )}
            {scanStatus === "connecting" && "Connecting…"}
            {scanStatus === "running"    && `Scanning ${target} · profile: ${profile}`}
            {scanStatus === "done"       && `Done — ${hosts.length} host(s) discovered`}
            {scanStatus === "error"      && "Scan failed — check terminal output"}
          </div>
        )}

        {/* ── Main grid: terminal + hosts ── */}
        <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-2 gap-4 min-h-0">

          {/* Terminal */}
          <div className="flex flex-col rounded-xl border border-border bg-card overflow-hidden min-h-0">
            <div className="flex items-center gap-2 border-b border-border px-4 py-2.5 shrink-0">
              <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Terminal</span>
              {lines.length > 0 && (
                <span className="ml-auto text-[10px] text-muted-foreground">{lines.length} lines</span>
              )}
            </div>
            <div
              ref={termRef}
              className="flex-1 overflow-y-auto scrollbar-thin p-4 font-mono text-[11px] leading-5 bg-zinc-950/60 space-y-px"
            >
              {lines.length === 0 ? (
                <span className="text-muted-foreground/30 italic">Set a target and click Scan…</span>
              ) : lines.map((ln, i) => (
                <div
                  key={i}
                  className={cn(
                    "whitespace-pre-wrap break-all",
                    ln.startsWith("✓")       ? "text-emerald-400" :
                    ln.startsWith("✗")       ? "text-red-400" :
                    ln.startsWith("$")       ? "text-brand-400 font-semibold" :
                    ln.includes("open")      ? "text-emerald-300" :
                    ln.startsWith("Nmap")    ? "text-zinc-400" :
                    "text-zinc-300"
                  )}
                >
                  {ln || " "}
                </div>
              ))}
            </div>
          </div>

          {/* Hosts + detail */}
          <div className="flex flex-col gap-3 min-h-0 overflow-hidden">

            {/* Host list */}
            <div className="rounded-xl border border-border bg-card overflow-hidden flex-none" style={{ maxHeight: "50%" }}>
              <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
                <Server className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Hosts</span>
                {hosts.length > 0 && (
                  <span className="ml-auto rounded-full bg-brand-500/20 px-2 py-0.5 text-[10px] font-bold text-brand-400">
                    {hosts.length}
                  </span>
                )}
              </div>
              <div className="overflow-y-auto scrollbar-thin" style={{ maxHeight: "calc(100% - 40px)" }}>
                {hosts.length === 0 ? (
                  <p className="px-4 py-6 text-xs text-muted-foreground/40 italic">
                    {scanStatus === "idle" ? "No scan started" : scanStatus === "done" ? "No hosts responded" : "Scanning…"}
                  </p>
                ) : hosts.map((h) => (
                  <button
                    key={h.ip}
                    onClick={() => setSelected(h)}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-2.5 text-left border-b border-border/40 last:border-0 transition-colors text-xs",
                      selected?.ip === h.ip ? "bg-brand-500/10" : "hover:bg-accent/30"
                    )}
                  >
                    <span className="relative flex h-1.5 w-1.5 shrink-0">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="font-mono font-semibold text-foreground">{h.ip}</p>
                      {h.hostname && <p className="text-[10px] text-muted-foreground truncate">{h.hostname}</p>}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[10px] text-muted-foreground">{h.ports.length} port{h.ports.length !== 1 ? "s" : ""}</p>
                      {h.os && <p className="text-[10px] text-brand-400 truncate max-w-[7rem]">{h.os}</p>}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Host detail */}
            {selected && (
              <div className="flex-1 rounded-xl border border-border bg-card overflow-hidden min-h-0 flex flex-col">
                <div className="flex items-center gap-2 border-b border-border px-4 py-2.5 shrink-0">
                  <Cpu className="h-3.5 w-3.5 text-brand-400" />
                  <span className="text-xs font-semibold font-mono text-foreground">{selected.ip}</span>
                  {selected.hostname && (
                    <span className="text-[10px] text-muted-foreground">({selected.hostname})</span>
                  )}
                </div>
                <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-3" style={{ minHeight: 0 }}>
                  {selected.os && (
                    <div className="flex items-center gap-2 rounded-md border border-brand-500/20 bg-brand-500/5 px-3 py-2">
                      <Cpu className="h-3.5 w-3.5 text-brand-400 shrink-0" />
                      <span className="text-xs text-brand-300">{selected.os}</span>
                    </div>
                  )}
                  {(() => {
                    const open   = selected.ports.filter((p) => p.state === "open");
                    const other  = selected.ports.filter((p) => p.state !== "open");
                    return (
                      <>
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                            Open Ports ({open.length})
                          </p>
                          {open.length === 0 ? (
                            <p className="text-xs text-muted-foreground/50 italic">None detected</p>
                          ) : (
                            <div className="rounded-md border border-border bg-background/40 px-3">
                              {open.map((p) => <PortRow key={`${p.port}${p.proto}`} {...p} />)}
                            </div>
                          )}
                        </div>
                        {other.length > 0 && (
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                              Other ({other.length})
                            </p>
                            <div className="rounded-md border border-border bg-background/40 px-3">
                              {other.map((p) => <PortRow key={`${p.port}${p.proto}`} {...p} />)}
                            </div>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
