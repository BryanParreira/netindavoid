"use client";
import { useState, useCallback } from "react";
import useSWR from "swr";
import { api } from "@/lib/api";
import { TopBar } from "@/components/layout/TopBar";
import { cn, formatBytes } from "@/lib/utils";
import { useWebSocket } from "@/hooks/useWebSocket";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { AlertTriangle, ArrowRight, RefreshCw } from "lucide-react";

const fetcher = (url: string) => api.get(url).then((r) => r.data);

const PROTO_COLORS: Record<string, string> = {
  "TLS/HTTPS": "#8b5cf6",
  "DNS":       "#22d3ee",
  "SSH":       "#f59e0b",
  "HTTP":      "#60a5fa",
  "UNKNOWN":   "#ef4444",
};

const RISK_META: Record<string, { label: string; color: string }> = {
  c2_comms:    { label: "C2 Comms",    color: "text-red-500   bg-red-500/10   border-red-500/20"    },
  brute_force: { label: "Brute Force", color: "text-orange-500 bg-orange-500/10 border-orange-500/20" },
};

const FLAG: Record<string, string> = {
  US: "🇺🇸", IE: "🇮🇪", CN: "🇨🇳", DE: "🇩🇪", GB: "🇬🇧", FR: "🇫🇷",
};

function RiskBadge({ risk }: { risk: string }) {
  const meta = RISK_META[risk] ?? { label: risk, color: "text-muted-foreground bg-muted border-border" };
  return (
    <span className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold", meta.color)}>
      <AlertTriangle className="h-2.5 w-2.5" />
      {meta.label}
    </span>
  );
}

function ProtoChip({ proto }: { proto: string }) {
  const color = PROTO_COLORS[proto] ?? "#6b7280";
  return (
    <span
      className="inline-block rounded px-1.5 py-0.5 text-[10px] font-bold"
      style={{ background: color + "22", color, border: `1px solid ${color}44` }}
    >
      {proto}
    </span>
  );
}

function ProtoPieTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-xl">
      <p className="font-medium text-foreground">{payload[0].name}</p>
      <p className="text-muted-foreground">{formatBytes(payload[0].value)}</p>
    </div>
  );
}

export default function FlowsPage() {
  const [protoFilter, setProtoFilter] = useState("all");
  const [riskOnly, setRiskOnly]       = useState(false);

  const { data: flows, mutate, isLoading } = useSWR("/flows", fetcher, { refreshInterval: 10_000 });

  const { connected } = useWebSocket("/ws/flows", useCallback(() => { mutate(); }, [mutate]));

  const allFlows: any[] = flows ?? [];

  const filtered = allFlows.filter((f) => {
    if (riskOnly && !f.risk) return false;
    if (protoFilter !== "all" && f.app_proto !== protoFilter) return false;
    return true;
  });

  // Protocol distribution for pie
  const protoMap: Record<string, number> = {};
  for (const f of allFlows) {
    const total = (f.bytes_toserver ?? 0) + (f.bytes_toclient ?? 0);
    protoMap[f.app_proto] = (protoMap[f.app_proto] ?? 0) + total;
  }
  const pieData = Object.entries(protoMap).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);

  const totalBytes = allFlows.reduce((s, f) => s + (f.bytes_toserver ?? 0) + (f.bytes_toclient ?? 0), 0);
  const totalFlows = allFlows.length;
  const riskFlows  = allFlows.filter((f) => f.risk).length;

  const protos = ["all", ...Array.from(new Set(allFlows.map((f) => f.app_proto)))];

  return (
    <div className="flex flex-col overflow-hidden h-full">
      <TopBar
        title="Network Flows"
        subtitle="Active connections · Suricata-style analysis"
        live={connected}
      />

      <div className="flex-1 overflow-y-auto p-5 scrollbar-thin space-y-5">

        {/* Stats row */}
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { label: "Active Flows",   value: totalFlows,           fmt: (v: number) => String(v),       color: "text-foreground" },
            { label: "Total Bandwidth", value: totalBytes,           fmt: formatBytes,                    color: "text-brand-400"  },
            { label: "Suspicious",     value: riskFlows,            fmt: (v: number) => String(v),       color: riskFlows > 0 ? "text-red-500" : "text-emerald-500" },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-border bg-card p-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{s.label}</p>
              <p className={cn("mt-1 text-2xl font-bold font-mono", s.color)}>{s.fmt(s.value)}</p>
            </div>
          ))}
        </div>

        {/* Protocol pie + filters */}
        <div className="grid gap-4 lg:grid-cols-3">

          {/* Pie */}
          <div className="rounded-xl border border-border bg-card p-5">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Protocol Mix</p>
            <ResponsiveContainer width="100%" height={160}>
              <PieChart>
                <Pie data={pieData} dataKey="value" cx="50%" cy="50%" innerRadius={40} outerRadius={70} paddingAngle={2}>
                  {pieData.map((entry) => (
                    <Cell key={entry.name} fill={PROTO_COLORS[entry.name] ?? "#6b7280"} />
                  ))}
                </Pie>
                <Tooltip content={<ProtoPieTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="mt-2 space-y-1">
              {pieData.map((e) => (
                <div key={e.name} className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full" style={{ background: PROTO_COLORS[e.name] ?? "#6b7280" }} />
                    <span className="text-muted-foreground">{e.name}</span>
                  </span>
                  <span className="font-mono text-foreground">{formatBytes(e.value)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Filters */}
          <div className="lg:col-span-2 rounded-xl border border-border bg-card p-5 space-y-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Filters</p>

            <div className="flex flex-wrap gap-2">
              {protos.map((p) => (
                <button
                  key={p}
                  onClick={() => setProtoFilter(p)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-medium transition-colors border",
                    protoFilter === p
                      ? "border-brand-500/40 bg-brand-500/10 text-brand-400"
                      : "border-border bg-muted text-muted-foreground hover:bg-accent"
                  )}
                >
                  {p === "all" ? "All protocols" : p}
                </button>
              ))}
            </div>

            <button
              onClick={() => setRiskOnly(!riskOnly)}
              className={cn(
                "flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                riskOnly
                  ? "border-red-500/30 bg-red-500/10 text-red-400"
                  : "border-border bg-muted text-muted-foreground hover:bg-accent"
              )}
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              Suspicious flows only
              {riskFlows > 0 && (
                <span className="ml-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                  {riskFlows}
                </span>
              )}
            </button>

            <div className="text-xs text-muted-foreground">
              Showing <span className="font-semibold text-foreground">{filtered.length}</span> of {totalFlows} flows
            </div>
          </div>
        </div>

        {/* Flows table */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Active Connections</p>
            <button onClick={() => mutate()} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
              <RefreshCw className="h-3 w-3" /> Refresh
            </button>
          </div>

          {isLoading ? (
            <div className="space-y-0">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 border-b border-border px-5 py-3 last:border-0">
                  <div className="h-3 w-32 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-24 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-20 animate-pulse rounded bg-muted" />
                </div>
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    {["Source", "", "Destination", "Protocol", "Data ↓↑", "Duration", "Country/ASN", "Device", "Risk"].map((h) => (
                      <th key={h} className="whitespace-nowrap px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((f) => (
                    <tr
                      key={f.id}
                      className={cn(
                        "transition-colors hover:bg-accent/20",
                        f.risk && "bg-red-500/[0.03]"
                      )}
                    >
                      <td className="px-4 py-2.5 font-mono text-foreground whitespace-nowrap">
                        {f.src_ip}<span className="text-muted-foreground">:{f.src_port}</span>
                      </td>
                      <td className="px-1 text-muted-foreground">
                        <ArrowRight className="h-3 w-3" />
                      </td>
                      <td className="px-4 py-2.5 font-mono text-foreground whitespace-nowrap">
                        {f.dst_ip}<span className="text-muted-foreground">:{f.dst_port}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <ProtoChip proto={f.app_proto} />
                      </td>
                      <td className="px-4 py-2.5 font-mono whitespace-nowrap">
                        <span className="text-emerald-500">{formatBytes(f.bytes_toclient)}</span>
                        {" "}<span className="text-muted-foreground/50">/</span>{" "}
                        <span className="text-violet-400">{formatBytes(f.bytes_toserver)}</span>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-muted-foreground whitespace-nowrap">
                        {f.duration_s >= 3600
                          ? `${(f.duration_s / 3600).toFixed(1)}h`
                          : f.duration_s >= 60
                          ? `${Math.floor(f.duration_s / 60)}m`
                          : `${f.duration_s}s`}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span className="mr-1">{FLAG[f.country] ?? "🌐"}</span>
                        <span className="text-muted-foreground">{f.asn}</span>
                      </td>
                      <td className="px-4 py-2.5 text-foreground whitespace-nowrap">{f.device_name}</td>
                      <td className="px-4 py-2.5">
                        {f.risk ? <RiskBadge risk={f.risk} /> : <span className="text-muted-foreground/30">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
