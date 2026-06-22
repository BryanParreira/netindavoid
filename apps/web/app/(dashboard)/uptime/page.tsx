"use client";
import { useState } from "react";
import useSWR from "swr";
import { api } from "@/lib/api";
import { TopBar } from "@/components/layout/TopBar";
import { cn } from "@/lib/utils";
import {
  CheckCircle2, XCircle, Clock, Wifi, Monitor, Smartphone,
  Tv2, Cpu, Globe, ArrowUpDown,
} from "lucide-react";

const fetcher = (url: string) => api.get(url).then((r) => r.data);

const CATEGORY_ICON: Record<string, React.ElementType> = {
  network: Wifi,
  computer: Monitor,
  mobile: Smartphone,
  media: Tv2,
  iot: Cpu,
  external: Globe,
};

const CATEGORY_ORDER = ["network", "external", "computer", "mobile", "iot", "media"];

function UptimeBadge({ pct }: { pct: number }) {
  const color =
    pct >= 99 ? "text-emerald-500 bg-emerald-500/10 border-emerald-500/20" :
    pct >= 95 ? "text-yellow-500 bg-yellow-500/10 border-yellow-500/20" :
                "text-red-500   bg-red-500/10   border-red-500/20";
  return (
    <span className={cn("inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-bold tabular-nums", color)}>
      {pct.toFixed(2)}%
    </span>
  );
}

function Heartbeat({ beats }: { beats: { ts: string; up: boolean; ms: number | null }[] }) {
  return (
    <div className="flex items-end gap-[2px]" title="Last 90 minutes">
      {beats.map((b, i) => (
        <div
          key={i}
          title={`${new Date(b.ts).toLocaleTimeString()} · ${b.up ? `${b.ms}ms` : "down"}`}
          className={cn(
            "w-[5px] rounded-[1px] transition-colors",
            b.up ? "bg-emerald-500/80 hover:bg-emerald-400" : "bg-red-500/80 hover:bg-red-400"
          )}
          style={{ height: b.up && b.ms ? `${Math.min(4 + (b.ms / 50) * 12, 16)}px` : "16px" }}
        />
      ))}
    </div>
  );
}

function MonitorRow({ m }: { m: any }) {
  const Icon = CATEGORY_ICON[m.category] ?? Globe;
  const isUp = m.status === "up";

  return (
    <div className="flex items-center gap-4 border-b border-border px-5 py-3.5 last:border-0 hover:bg-accent/20 transition-colors">
      {/* Status */}
      <div className="shrink-0">
        {isUp
          ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          : <XCircle      className="h-4 w-4 text-red-500" />
        }
      </div>

      {/* Icon + name */}
      <div className="flex items-center gap-2.5 w-52 shrink-0">
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <div>
          <p className="text-xs font-medium text-foreground">{m.name}</p>
          <p className="text-[10px] text-muted-foreground font-mono">{m.target}</p>
        </div>
      </div>

      {/* Heartbeat */}
      <div className="flex-1 min-w-0">
        <Heartbeat beats={m.heartbeat} />
      </div>

      {/* Response time */}
      <div className="w-16 shrink-0 text-right">
        {m.avg_ms != null ? (
          <div className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span className="font-mono">{m.avg_ms}ms</span>
          </div>
        ) : (
          <span className="text-xs text-red-500/70 font-mono">—</span>
        )}
      </div>

      {/* Uptime */}
      <div className="w-20 shrink-0 text-right">
        <UptimeBadge pct={m.uptime} />
      </div>

      {/* Type chip */}
      <div className="w-12 shrink-0 text-right">
        <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/60 bg-muted px-1.5 py-0.5 rounded">
          {m.type}
        </span>
      </div>
    </div>
  );
}

export default function UptimePage() {
  const { data: monitors, isLoading } = useSWR("/uptime/monitors", fetcher, { refreshInterval: 30_000 });
  const [group, setGroup] = useState(true);

  const total  = monitors?.length ?? 0;
  const up     = monitors?.filter((m: any) => m.status === "up").length ?? 0;
  const avgPct = monitors ? (monitors.reduce((a: number, m: any) => a + m.uptime, 0) / monitors.length).toFixed(2) : "—";

  const groups: Record<string, any[]> = {};
  if (monitors) {
    if (group) {
      for (const cat of CATEGORY_ORDER) {
        const items = monitors.filter((m: any) => m.category === cat);
        if (items.length) groups[cat] = items;
      }
    } else {
      groups["All Monitors"] = monitors;
    }
  }

  return (
    <div className="flex flex-col overflow-hidden h-full">
      <TopBar
        title="Uptime Monitor"
        subtitle="Service availability across your network"
        live
      />

      <div className="flex-1 overflow-y-auto p-5 scrollbar-thin space-y-5">

        {/* Summary */}
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { label: "Monitors Up",   value: `${up} / ${total}`,  color: up === total ? "text-emerald-500" : "text-yellow-500" },
            { label: "Avg Uptime",    value: `${avgPct}%`,          color: "text-foreground" },
            { label: "Incidents Today", value: monitors ? String(monitors.filter((m: any) => m.uptime < 99).length) : "—", color: "text-muted-foreground" },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-border bg-card p-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{s.label}</p>
              <p className={cn("mt-1 text-2xl font-bold font-mono", s.color)}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setGroup(!group)}
            className={cn(
              "flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
              group
                ? "border-brand-500/30 bg-brand-500/10 text-brand-400"
                : "border-border bg-muted text-muted-foreground hover:bg-accent"
            )}
          >
            <ArrowUpDown className="h-3 w-3" />
            Group by category
          </button>
          <span className="ml-auto text-xs text-muted-foreground">
            Last 90 min · 1-min checks
          </span>
        </div>

        {/* Monitor list */}
        {isLoading ? (
          <div className="rounded-xl border border-border bg-card">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 border-b border-border px-5 py-3.5 last:border-0">
                <div className="h-4 w-4 animate-pulse rounded-full bg-muted" />
                <div className="h-3 w-40 animate-pulse rounded bg-muted" />
                <div className="flex-1 h-4 animate-pulse rounded bg-muted" />
                <div className="h-3 w-16 animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : (
          Object.entries(groups).map(([cat, items]) => (
            <div key={cat} className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-5 py-2.5">
                {(() => { const Icon = CATEGORY_ICON[cat] ?? Globe; return <Icon className="h-3.5 w-3.5 text-muted-foreground" />; })()}
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  {cat.charAt(0).toUpperCase() + cat.slice(1)}
                </p>
                <span className="ml-auto text-[10px] text-muted-foreground">
                  {items.filter((m) => m.status === "up").length}/{items.length} up
                </span>
              </div>
              {items.map((m) => <MonitorRow key={m.id} m={m} />)}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
