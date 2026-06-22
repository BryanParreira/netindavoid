"use client";
import { useState, useCallback, useRef, useEffect } from "react";
import useSWR from "swr";
import { api } from "@/lib/api";
import { TopBar } from "@/components/layout/TopBar";
import { BandwidthChart } from "@/components/charts/BandwidthChart";
import { formatBytes, formatMbps } from "@/lib/utils";
import { useWebSocket } from "@/hooks/useWebSocket";
import { Activity, ArrowDown, ArrowUp, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

const fetcher = (url: string) => api.get(url).then((r) => r.data);

// Keeps the last N seconds of live bandwidth readings for sparkline
const MAX_LIVE_POINTS = 60;

function LiveMeter({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = Math.min((value / Math.max(max, 0.01)) * 100, 100);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn("font-mono font-bold", color)}>{formatMbps(value)}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full transition-all duration-500", color.replace("text-", "bg-"))}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function LiveSparkline({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const max = Math.max(...points, 0.01);
  const w = 200, h = 40;
  const pts = points.map((v, i) => {
    const x = (i / (points.length - 1)) * w;
    const y = h - (v / max) * (h - 4) - 2;
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"
        className="text-brand-400" />
      <polyline
        points={`0,${h} ${pts} ${w},${h}`}
        fill="currentColor" stroke="none" className="text-brand-500/15" />
    </svg>
  );
}

export default function TrafficPage() {
  const [hours, setHours] = useState(24);
  const { data, isLoading } = useSWR(`/traffic/overview?hours=${hours}`, fetcher, { refreshInterval: 10_000 });

  const [liveIn, setLiveIn]   = useState(0);
  const [liveOut, setLiveOut] = useState(0);
  const [lastSeen, setLastSeen] = useState<Date | null>(null);
  const historyIn  = useRef<number[]>([]);
  const historyOut = useRef<number[]>([]);
  const [, forceRender] = useState(0);

  const { connected } = useWebSocket("/ws/live-traffic", useCallback((d: unknown) => {
    const msg = d as { bytes_in?: number; bytes_out?: number };
    if (msg.bytes_in != null) {
      const mbpsIn  = (msg.bytes_in  / 60) * 8 / 1e6;
      const mbpsOut = ((msg.bytes_out ?? 0) / 60) * 8 / 1e6;
      setLiveIn(mbpsIn);
      setLiveOut(mbpsOut);
      setLastSeen(new Date());
      historyIn.current  = [...historyIn.current.slice(-(MAX_LIVE_POINTS - 1)), mbpsIn];
      historyOut.current = [...historyOut.current.slice(-(MAX_LIVE_POINTS - 1)), mbpsOut];
      forceRender(n => n + 1);
    }
  }, []));

  // Live ticker: how many seconds since last WS message
  const [secAgo, setSecAgo] = useState<number | null>(null);
  useEffect(() => {
    const t = setInterval(() => {
      if (lastSeen) setSecAgo(Math.round((Date.now() - lastSeen.getTime()) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, [lastSeen]);

  const mbpsIn  = liveIn  || data?.summary?.current_mbps_in  || 0;
  const mbpsOut = liveOut || data?.summary?.current_mbps_out || 0;
  const peakIn  = data?.summary?.peak_mbps_in  || 0;
  const peakOut = data?.summary?.peak_mbps_out || 0;

  return (
    <div className="flex flex-col overflow-hidden h-full">
      <TopBar title="Traffic" subtitle="Real-time bandwidth monitoring" live />

      <div className="flex-1 overflow-y-auto p-5 scrollbar-thin space-y-5">

        {/* Time range */}
        <div className="flex items-center gap-2">
          {[6, 24, 48, 168].map((h) => (
            <button key={h} onClick={() => setHours(h)}
              className={cn("rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                hours === h ? "bg-brand-500 text-white" : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground")}>
              {h < 48 ? `${h}h` : `${h/24}d`}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2 text-[10px] text-muted-foreground">
            {connected
              ? <span className="flex items-center gap-1.5 text-emerald-500"><span className="relative flex h-1.5 w-1.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" /><span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" /></span>WebSocket live{secAgo != null ? ` · ${secAgo}s ago` : ""}</span>
              : <span className="text-yellow-500/70">Connecting…</span>
            }
          </div>
        </div>

        {/* Live bandwidth card */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-brand-400" />
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Live Bandwidth</p>
            </div>
            <div className="text-[10px] text-muted-foreground">Updated every ~60s via WebSocket</div>
          </div>

          <div className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-3">
              <div className="flex items-end gap-3">
                <p className="text-3xl font-bold font-mono text-brand-400">{formatMbps(mbpsIn)}</p>
                <div className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <ArrowDown className="h-3 w-3 text-emerald-500" /> Download
                </div>
              </div>
              <LiveMeter label="vs peak" value={mbpsIn} max={peakIn} color="text-brand-400" />
              <LiveSparkline points={historyIn.current} />
            </div>
            <div className="space-y-3">
              <div className="flex items-end gap-3">
                <p className="text-3xl font-bold font-mono text-violet-400">{formatMbps(mbpsOut)}</p>
                <div className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <ArrowUp className="h-3 w-3 text-violet-400" /> Upload
                </div>
              </div>
              <LiveMeter label="vs peak" value={mbpsOut} max={peakOut} color="text-violet-400" />
              <LiveSparkline points={historyOut.current} />
            </div>
          </div>
        </div>

        {/* Summary stats */}
        {data?.summary && (
          <div className="grid gap-3 sm:grid-cols-4">
            {[
              { label: "Downloaded (period)",  value: formatBytes(data.summary.total_bytes_in),  icon: <ArrowDown className="h-3.5 w-3.5 text-emerald-500" /> },
              { label: "Uploaded (period)",    value: formatBytes(data.summary.total_bytes_out), icon: <ArrowUp   className="h-3.5 w-3.5 text-violet-400" /> },
              { label: "Peak Download",        value: formatMbps(peakIn),                        icon: <Activity  className="h-3.5 w-3.5 text-brand-400" /> },
              { label: "Peak Upload",          value: formatMbps(peakOut),                       icon: <Activity  className="h-3.5 w-3.5 text-brand-300" /> },
            ].map((s) => (
              <div key={s.label} className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-center gap-1.5 mb-1">{s.icon}<p className="text-[10px] text-muted-foreground uppercase tracking-wide">{s.label}</p></div>
                <p className="text-lg font-bold font-mono text-foreground">{s.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Historical bandwidth chart */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Network Bandwidth — Last {hours}h</h2>
            <div className="flex gap-4 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="h-1.5 w-3 rounded bg-brand-500" />Download</span>
              <span className="flex items-center gap-1.5"><span className="h-1.5 w-3 rounded bg-violet-500" />Upload</span>
            </div>
          </div>
          {isLoading
            ? <div className="flex h-[260px] items-center justify-center text-xs text-muted-foreground">Loading…</div>
            : data?.timeseries
              ? <BandwidthChart data={data.timeseries} height={260} />
              : <div className="flex h-[260px] items-center justify-center text-xs text-muted-foreground">No data for this period</div>
          }
        </div>

        {/* Top talkers */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="border-b border-border px-5 py-3 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Top Bandwidth Users</h2>
            <span className="text-[10px] text-muted-foreground">Last {hours}h</span>
          </div>
          {data?.top_talkers?.length ? (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-5 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Device</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Download</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Upload</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Total</th>
                  <th className="px-5 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Share</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.top_talkers.map((t: any) => (
                  <tr key={t.device_id} className="transition-colors hover:bg-accent/25">
                    <td className="px-5 py-3 font-medium text-foreground">{t.device_name}</td>
                    <td className="px-4 py-3 text-right font-mono text-emerald-500/80">{formatBytes(t.bytes_in)}</td>
                    <td className="px-4 py-3 text-right font-mono text-violet-400/80">{formatBytes(t.bytes_out)}</td>
                    <td className="px-4 py-3 text-right font-mono text-foreground">{formatBytes(t.total_bytes)}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-1 w-24 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${t.percentage}%` }} />
                        </div>
                        <span className="font-mono text-muted-foreground">{t.percentage}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="px-5 py-10 text-center text-xs text-muted-foreground">No data</div>
          )}
        </div>

      </div>
    </div>
  );
}
