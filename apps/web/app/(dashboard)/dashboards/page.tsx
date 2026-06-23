"use client";
import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { TopBar } from "@/components/layout/TopBar";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import { AlertCircle, RefreshCw, ExternalLink, Database } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type SearchResult =
  | { type: "events"; total: number; events: any[] }
  | { type: "stats";  columns: string[]; rows: Record<string, any>[] }
  | { type: "timechart"; series: string[]; columns: string[]; rows: Record<string, any>[] };

type PanelDef = {
  id:        string;
  title:     string;
  query:     string;
  timeRange: string;
  vizType:   "bar" | "pie" | "table" | "single" | "timechart";
  span:      1 | 2 | 3;
};

// ── Pre-built SIEM panels ─────────────────────────────────────────────────────

const PANELS: PanelDef[] = [
  {
    id: "event-volume", title: "Event Volume (24h)", span: 3,
    query: "* | timechart count by severity", timeRange: "last_24h", vizType: "timechart",
  },
  {
    id: "top-sourcetypes", title: "Top Source Types", span: 1,
    query: "* | top 10 sourcetype", timeRange: "last_24h", vizType: "bar",
  },
  {
    id: "top-hosts", title: "Top Hosts by Events", span: 1,
    query: "* | top 10 host", timeRange: "last_24h", vizType: "bar",
  },
  {
    id: "severity-breakdown", title: "Severity Breakdown", span: 1,
    query: "* | top severity", timeRange: "last_24h", vizType: "pie",
  },
  {
    id: "critical-events", title: "Recent Critical & Error Events", span: 3,
    query: "severity=critical OR severity=error | head 20", timeRange: "last_24h", vizType: "table",
  },
  {
    id: "top-indexes", title: "Events by Index", span: 1,
    query: "* | top index", timeRange: "last_24h", vizType: "pie",
  },
  {
    id: "dns-top", title: "Top DNS Queries", span: 1,
    query: "sourcetype=dns:query | top 10 domain", timeRange: "last_24h", vizType: "bar",
  },
  {
    id: "alerts-count", title: "Security Alerts", span: 1,
    query: "sourcetype=vex:alert | stats count by severity", timeRange: "last_7d", vizType: "table",
  },
];

// ── Chart colors ──────────────────────────────────────────────────────────────

const COLORS = ["#8b5cf6","#22d3ee","#f59e0b","#60a5fa","#ef4444","#10b981","#f97316","#a78bfa","#34d399","#fb7185"];
const SEV_COLOR: Record<string, string> = {
  critical: "#ef4444", error: "#f97316", warning: "#f59e0b",
  notice: "#60a5fa", info: "#10b981", debug: "#6b7280",
};

// ── Panel component ───────────────────────────────────────────────────────────

function Panel({ def, onOpen }: { def: PanelDef; onOpen: (query: string, timeRange: string) => void }) {
  const [result, setResult]   = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api.post("/logs/search", { query: def.query, time_range: def.timeRange, limit: 100 })
      .then((r) => setResult(r.data))
      .catch((e) => setError(e.response?.data?.detail || "Failed to load"))
      .finally(() => setLoading(false));
  }, [def.query, def.timeRange]);

  const content = (() => {
    if (loading) return (
      <div className="flex items-center justify-center h-full">
        <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
    if (error) return (
      <div className="flex flex-col items-center justify-center h-full gap-1">
        <AlertCircle className="h-5 w-5 text-muted-foreground/40" />
        <p className="text-[10px] text-muted-foreground/60">{error}</p>
      </div>
    );
    if (!result) return null;

    // Single value
    if (def.vizType === "single" && result.type === "stats") {
      const val = result.rows[0]?.[result.columns[0]] ?? 0;
      return (
        <div className="flex items-center justify-center h-full">
          <p className="text-4xl font-bold font-mono text-brand-400">{val}</p>
        </div>
      );
    }

    // Time chart
    if (def.vizType === "timechart" && result.type === "timechart") {
      return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={result.rows} margin={{ top: 4, right: 8, bottom: 24, left: 0 }}>
            <XAxis dataKey="_time" tickFormatter={(v) => { try { return new Date(v).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } catch { return v; } }} tick={{ fontSize: 8, fill: "#6b7280" }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 8, fill: "#6b7280" }} width={28} />
            <Tooltip contentStyle={{ background: "#18181b", border: "1px solid #27272a", borderRadius: 8, fontSize: 10 }} labelFormatter={(v) => { try { return new Date(v).toLocaleString(); } catch { return v; } }} />
            {result.series.map((s, i) => (
              <Bar key={s} dataKey={s} stackId="a" fill={(SEV_COLOR as any)[s] || COLORS[i % COLORS.length]} radius={i === result.series.length - 1 ? [2, 2, 0, 0] : undefined} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      );
    }

    // Bar chart (from stats/top)
    if (def.vizType === "bar" && result.type === "stats") {
      const labelCol = result.columns.find((c) => !["count", "percent"].includes(c));
      const countCol = "count";
      if (!labelCol) return null;
      return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={result.rows} layout="vertical" margin={{ top: 0, right: 40, bottom: 0, left: 60 }}>
            <XAxis type="number" tick={{ fontSize: 8, fill: "#6b7280" }} />
            <YAxis type="category" dataKey={labelCol} width={60} tick={{ fontSize: 8, fill: "#6b7280" }} />
            <Tooltip contentStyle={{ background: "#18181b", border: "1px solid #27272a", borderRadius: 8, fontSize: 10 }} />
            <Bar dataKey={countCol} fill="#8b5cf6" radius={[0, 3, 3, 0]} />
          </BarChart>
        </ResponsiveContainer>
      );
    }

    // Pie chart
    if (def.vizType === "pie" && result.type === "stats") {
      const labelCol = result.columns.find((c) => !["count", "percent"].includes(c));
      if (!labelCol) return null;
      return (
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={result.rows} dataKey="count" nameKey={labelCol} cx="50%" cy="50%" outerRadius={70} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
              {result.rows.map((r, i) => (
                <Cell key={i} fill={(SEV_COLOR as any)[r[labelCol]] || COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={{ background: "#18181b", border: "1px solid #27272a", borderRadius: 8, fontSize: 10 }} />
          </PieChart>
        </ResponsiveContainer>
      );
    }

    // Table (events or stats)
    if (def.vizType === "table") {
      if (result.type === "events") {
        if (!result.events.length) return <div className="flex items-center justify-center h-full text-xs text-muted-foreground/50">No critical events</div>;
        return (
          <div className="overflow-y-auto h-full scrollbar-thin">
            {result.events.slice(0, 10).map((ev) => (
              <div key={ev.id} className="flex items-center gap-2 px-2 py-1.5 border-b border-border/30 last:border-0 text-[11px]">
                <span className={cn("shrink-0 h-1.5 w-1.5 rounded-full", ev.severity === "critical" ? "bg-red-500" : "bg-orange-400")} />
                <span className="text-muted-foreground shrink-0 text-[10px] font-mono">{new Date(ev.timestamp).toLocaleTimeString()}</span>
                <span className="flex-1 truncate text-foreground/80">{ev.message}</span>
                {ev.host && <span className="shrink-0 text-[9px] bg-muted rounded px-1 text-muted-foreground">{ev.host}</span>}
              </div>
            ))}
          </div>
        );
      }
      if (result.type === "stats") {
        return (
          <div className="overflow-y-auto h-full scrollbar-thin">
            <table className="w-full text-[10px]">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b border-border">
                  {result.columns.map((c) => <th key={c} className="px-2 py-1.5 text-left font-semibold text-muted-foreground uppercase tracking-wide">{c}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {result.rows.map((row, i) => (
                  <tr key={i} className="hover:bg-accent/20">
                    {result.columns.map((c) => <td key={c} className="px-2 py-1.5 font-mono text-foreground">{row[c] != null ? String(row[c]) : "—"}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
    }

    return <p className="text-xs text-muted-foreground/50 text-center mt-8">No data</p>;
  })();

  const gridCols: Record<number, string> = { 1: "col-span-1", 2: "col-span-2", 3: "col-span-3" };

  return (
    <div className={cn("rounded-xl border border-border bg-card overflow-hidden flex flex-col", gridCols[def.span] ?? "col-span-1")}>
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5 shrink-0">
        <p className="text-xs font-semibold text-foreground">{def.title}</p>
        <span className="ml-auto text-[9px] text-muted-foreground/50 font-mono">{def.timeRange}</span>
        <button
          onClick={() => onOpen(def.query, def.timeRange)}
          title="Open in search"
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <ExternalLink className="h-3 w-3" />
        </button>
      </div>
      <div className="flex-1 p-3" style={{ minHeight: 180 }}>
        {content}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DashboardsPage() {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const { data } = await api.post("/logs/sync");
      window.location.reload();
    } catch {
    } finally {
      setSyncing(false);
    }
  };

  const openSearch = (query: string, timeRange: string) => {
    // Navigate to logs page with pre-filled query
    router.push(`/logs?q=${encodeURIComponent(query)}&t=${encodeURIComponent(timeRange)}`);
  };

  return (
    <div className="flex flex-col overflow-hidden h-full">
      <TopBar
        title="Log Analytics"
        subtitle="SIEM — query events, sourcetypes, and hosts"
        actions={
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-1.5 rounded-md border border-border bg-muted px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-50 transition-colors"
          >
            {syncing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Database className="h-3.5 w-3.5" />}
            Sync Data
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto scrollbar-thin p-5">

        {/* No data banner — shown until first sync */}
        {false && (
          <div className="mb-5 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-amber-400 shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-300">No log data yet</p>
              <p className="text-xs text-amber-400/70 mt-0.5">
                Click <strong>Sync Data</strong> to import alerts, DNS queries, and scan results from your existing data.
                Or go to <strong>Log Search</strong> to upload log files / ingest via HEC.
              </p>
            </div>
            <button onClick={handleSync} disabled={syncing} className="ml-auto shrink-0 rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-black hover:bg-amber-400 disabled:opacity-50">
              {syncing ? "Syncing…" : "Sync Now"}
            </button>
          </div>
        )}

        {/* Dashboard grid — 3 columns */}
        <div className="grid grid-cols-3 gap-4" style={{ gridAutoRows: "220px" }}>
          {PANELS.map((panel) => (
            <Panel key={panel.id} def={panel} onOpen={openSearch} />
          ))}
        </div>
      </div>
    </div>
  );
}
