"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { api, WS_URL } from "@/lib/api";
import { TopBar } from "@/components/layout/TopBar";
import { cn } from "@/lib/utils";
import {
  Search, Square, Save, Upload, Download, RefreshCw,
  ChevronRight, ChevronDown, Database, Radio, FileText,
  AlertCircle, AlertTriangle, Info, X,
} from "lucide-react";
import toast from "react-hot-toast";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";

// ── Types ─────────────────────────────────────────────────────────────────────

type LogEvent = {
  id: string; timestamp: string; index: string; source: string | null;
  sourcetype: string | null; host: string | null; message: string;
  severity: string | null; fields: Record<string, string>;
};

type SearchResult =
  | { type: "events";    total: number; events: LogEvent[]; time_from: string; time_to: string }
  | { type: "stats";     columns: string[]; rows: Record<string, any>[]; time_from: string; time_to: string }
  | { type: "timechart"; series: string[]; columns: string[]; rows: Record<string, any>[]; time_from: string; time_to: string };

type Tab = "events" | "statistics" | "visualization";

// ── Constants ─────────────────────────────────────────────────────────────────

const TIME_PRESETS = [
  { label: "Real-time",  value: "last_15m" },
  { label: "Last 15m",   value: "last_15m" },
  { label: "Last 1 hour",value: "last_1h"  },
  { label: "Last 4 hours",value:"last_4h"  },
  { label: "Last 24 hours",value:"last_24h"},
  { label: "Last 7 days", value:"last_7d"  },
  { label: "Last 30 days",value:"last_30d" },
];

const CHART_COLORS = ["#8b5cf6","#a78bfa","#22d3ee","#34d399","#ef4444","#60a5fa","#fb7185","#f59e0b"];

const SEV_COLOR: Record<string, string> = {
  critical: "#ef4444", error: "#f97316", warning: "#eab308",
  notice: "#60a5fa", info: "#8b5cf6", debug: "#6b7280",
};

// ── Severity badge ────────────────────────────────────────────────────────────

function SevBadge({ sev }: { sev: string | null }) {
  const s = (sev || "info").toLowerCase();
  const cls: Record<string, string> = {
    critical: "bg-red-500/15 text-red-400 border-red-500/30",
    error:    "bg-orange-500/15 text-orange-400 border-orange-500/30",
    warning:  "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
    notice:   "bg-blue-500/15 text-blue-400 border-blue-500/30",
    info:     "bg-green-500/15 text-green-400 border-green-500/30",
    debug:    "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
  };
  return (
    <span className={cn("inline-flex items-center rounded border px-1.5 py-0 text-[10px] font-bold uppercase tracking-wide shrink-0", cls[s] ?? cls.info)}>
      {s}
    </span>
  );
}

// ── Event row (Splunk style) ──────────────────────────────────────────────────

function EventRow({ ev, num }: { ev: LogEvent; num: number }) {
  const [open, setOpen] = useState(false);
  const sev = (ev.severity || "info").toLowerCase();
  const color = SEV_COLOR[sev] || "#6b7280";

  return (
    <div
      className={cn("border-b transition-colors cursor-pointer", open ? "bg-[hsl(222_28%_18%)]" : "hover:bg-[hsl(222_28%_17%)]")}
      style={{ borderColor: "hsl(var(--border))" }}
    >
      <div
        onClick={() => setOpen(!open)}
        className="flex items-start gap-0 text-[11px]"
      >
        {/* Severity bar */}
        <div className="w-1 self-stretch shrink-0 rounded-none" style={{ background: color }} />

        {/* Row number */}
        <span className="w-9 shrink-0 py-2 text-center font-mono text-[10px] select-none"
              style={{ color: "hsl(220 12% 36%)" }}>
          {num}
        </span>

        {/* Toggle */}
        <span className="w-5 shrink-0 py-2 flex items-center justify-center"
              style={{ color: "hsl(220 12% 40%)" }}>
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </span>

        {/* Timestamp */}
        <span className="w-36 shrink-0 py-2 font-mono text-[10px]"
              style={{ color: "hsl(220 12% 50%)" }}>
          {new Date(ev.timestamp).toLocaleString()}
        </span>

        {/* Severity badge */}
        <span className="w-20 shrink-0 py-2">
          <SevBadge sev={ev.severity} />
        </span>

        {/* Host */}
        {ev.host && (
          <span className="w-28 shrink-0 py-2 truncate font-mono"
                style={{ color: "#8b5cf6" }}>
            {ev.host}
          </span>
        )}

        {/* Source type */}
        {ev.sourcetype && (
          <span className="w-32 shrink-0 py-2 truncate text-[10px]"
                style={{ color: "hsl(220 14% 52%)" }}>
            {ev.sourcetype}
          </span>
        )}

        {/* Message */}
        <span className="flex-1 min-w-0 py-2 pr-4 font-mono truncate"
              style={{ color: "hsl(220 18% 80%)" }}>
          {ev.message}
        </span>
      </div>

      {open && (
        <div className="ml-[100px] mr-4 pb-4 space-y-3 animate-fade-in">
          {/* Meta */}
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] font-mono py-2 border-t"
               style={{ borderColor: "hsl(var(--border))" }}>
            <span style={{ color: "hsl(220 12% 46%)" }}>
              index=<span style={{ color: "#8b5cf6" }}>{ev.index}</span>
            </span>
            {ev.source && <span style={{ color: "hsl(220 12% 46%)" }}>
              source=<span style={{ color: "#8b5cf6" }}>{ev.source}</span>
            </span>}
            {ev.sourcetype && <span style={{ color: "hsl(220 12% 46%)" }}>
              sourcetype=<span style={{ color: "#8b5cf6" }}>{ev.sourcetype}</span>
            </span>}
            {ev.host && <span style={{ color: "hsl(220 12% 46%)" }}>
              host=<span style={{ color: "#8b5cf6" }}>{ev.host}</span>
            </span>}
          </div>

          {/* Extracted fields */}
          {Object.keys(ev.fields).length > 0 && (
            <div className="rounded border p-3" style={{ background: "hsl(222 35% 11%)", borderColor: "hsl(var(--border))" }}>
              <p className="text-[9px] font-semibold uppercase tracking-widest mb-2"
                 style={{ color: "hsl(220 12% 42%)" }}>Extracted Fields</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-x-8 gap-y-0.5">
                {Object.entries(ev.fields).map(([k, v]) => (
                  <div key={k} className="flex gap-1.5 text-[11px] font-mono">
                    <span style={{ color: "#8b5cf6" }}>{k}</span>
                    <span style={{ color: "hsl(220 12% 44%)" }}>=</span>
                    <span style={{ color: "hsl(220 18% 78%)" }} className="truncate">{String(v)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Raw */}
          <div className="rounded border p-3" style={{ background: "hsl(222 40% 8%)", borderColor: "hsl(var(--border))" }}>
            <p className="text-[9px] font-semibold uppercase tracking-widest mb-1.5"
               style={{ color: "hsl(220 12% 42%)" }}>Raw Event</p>
            <pre className="text-[11px] font-mono whitespace-pre-wrap break-all"
                 style={{ color: "hsl(220 15% 72%)" }}>{ev.message}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Field facet ───────────────────────────────────────────────────────────────

function FieldFacet({
  label, values, onFilter,
}: { label: string; values: [string, number][]; onFilter: (f: string, v: string) => void }) {
  const [open, setOpen] = useState(true);
  const total = values.reduce((a, [, n]) => a + n, 0) || 1;
  return (
    <div className="mb-4">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1 text-[10px] font-bold uppercase tracking-widest mb-1.5 hover:opacity-80"
        style={{ color: "hsl(220 12% 48%)" }}
      >
        {open ? <ChevronDown className="h-2.5 w-2.5" /> : <ChevronRight className="h-2.5 w-2.5" />}
        {label}
      </button>
      {open && (
        <div className="space-y-px">
          {values.slice(0, 10).map(([val, cnt]) => (
            <button
              key={val}
              onClick={() => onFilter(label, val)}
              className="w-full flex items-center gap-2 px-1 py-0.5 rounded-sm text-[10px] transition-colors hover:bg-white/5 group"
            >
              <div className="h-1 w-16 shrink-0 rounded-full overflow-hidden"
                   style={{ background: "hsl(222 28% 20%)" }}>
                <div className="h-full rounded-full"
                     style={{ width: `${(cnt / total) * 100}%`, background: "#8b5cf6" }} />
              </div>
              <span className="flex-1 text-left truncate" style={{ color: "hsl(220 15% 65%)" }}>
                {val || <em style={{ color: "hsl(220 12% 40%)" }}>empty</em>}
              </span>
              <span className="font-mono shrink-0" style={{ color: "hsl(220 12% 44%)" }}>{cnt}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Visualization ─────────────────────────────────────────────────────────────

function Visualization({ result }: { result: SearchResult }) {
  const tooltipStyle = { background: "#0d1526", border: "1px solid hsl(222 26% 20%)", borderRadius: 4, fontSize: 11, color: "#d4daf0" };

  if (result.type === "timechart") {
    return (
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={result.rows} margin={{ top: 8, right: 8, bottom: 32, left: 0 }}>
          <XAxis dataKey="_time"
            tickFormatter={(v) => { try { return new Date(v).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } catch { return v; } }}
            tick={{ fontSize: 9, fill: "hsl(220 12% 42%)" }} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 9, fill: "hsl(220 12% 42%)" }} width={30} />
          <Tooltip contentStyle={tooltipStyle}
            labelFormatter={(v) => { try { return new Date(v).toLocaleString(); } catch { return v; } }} />
          {result.series.map((s, i) => (
            <Bar key={s} dataKey={s} stackId="a" fill={CHART_COLORS[i % CHART_COLORS.length]} radius={i === result.series.length - 1 ? [2,2,0,0] : undefined} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    );
  }

  if (result.type === "stats") {
    const countCol = result.columns.find((c) => c === "count" || c.startsWith("count"));
    const labelCol = result.columns.find((c) => c !== countCol && c !== "percent");
    if (labelCol && countCol) return (
      <ResponsiveContainer width="100%" height={320}>
        <BarChart data={result.rows.slice(0, 20)} layout="vertical" margin={{ top: 4, right: 50, bottom: 4, left: 90 }}>
          <XAxis type="number" tick={{ fontSize: 9, fill: "hsl(220 12% 42%)" }} />
          <YAxis type="category" dataKey={labelCol} width={90} tick={{ fontSize: 9, fill: "hsl(220 12% 42%)" }} />
          <Tooltip contentStyle={tooltipStyle} />
          <Bar dataKey={countCol} fill="#8b5cf6" radius={[0,3,3,0]} />
        </BarChart>
      </ResponsiveContainer>
    );
  }

  return <p className="text-center py-12 text-xs" style={{ color: "hsl(220 12% 40%)" }}>No visualization for this result type.</p>;
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function LogsPage() {
  const [query, setQuery]         = useState("*");
  const [timeRange, setTimeRange] = useState("last_24h");
  const [running, setRunning]     = useState(false);
  const [result, setResult]       = useState<SearchResult | null>(null);
  const [tab, setTab]             = useState<Tab>("events");
  const [liveMode, setLiveMode]   = useState(false);
  const [livePkts, setLivePkts]   = useState<LogEvent[]>([]);
  const [saveModal, setSaveModal] = useState(false);
  const [saveName, setSaveName]   = useState("");
  const [indexes, setIndexes]     = useState<{ name: string; count: number }[]>([]);
  const [sourcetypes, setSourcetypes] = useState<{ name: string; count: number }[]>([]);
  const [logStats, setLogStats]   = useState<{ total_events: number; last_24h: number; critical_24h: number } | null>(null);

  const wsRef  = useRef<WebSocket | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.get("/logs/indexes").then(r => setIndexes(r.data)).catch(() => {});
    api.get("/logs/sourcetypes").then(r => setSourcetypes(r.data)).catch(() => {});
    api.get("/logs/stats").then(r => setLogStats(r.data)).catch(() => {});
  }, [result]);

  useEffect(() => () => { wsRef.current?.close(); }, []);

  const fieldFacets = (() => {
    if (result?.type !== "events" || !result.events.length) return {};
    const f: Record<string, Record<string, number>> = { host: {}, sourcetype: {}, severity: {}, index: {} };
    for (const ev of result.events) {
      if (ev.host)       f.host[ev.host]             = (f.host[ev.host] || 0) + 1;
      if (ev.sourcetype) f.sourcetype[ev.sourcetype] = (f.sourcetype[ev.sourcetype] || 0) + 1;
      if (ev.severity)   f.severity[ev.severity]     = (f.severity[ev.severity] || 0) + 1;
      if (ev.index)      f.index[ev.index]           = (f.index[ev.index] || 0) + 1;
    }
    return f;
  })();

  const handleSearch = useCallback(async () => {
    setRunning(true); setResult(null);
    try {
      const { data } = await api.post("/logs/search", { query, time_range: timeRange, limit: 1000 });
      setResult(data);
      if (data.type === "stats")         setTab("statistics");
      else if (data.type === "timechart") setTab("visualization");
      else                                setTab("events");
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Search failed");
    } finally {
      setRunning(false);
    }
  }, [query, timeRange]);

  const toggleLive = () => {
    if (liveMode) { wsRef.current?.close(); setLiveMode(false); return; }
    setLivePkts([]); setLiveMode(true);
    
    const ws = new WebSocket(`${WS_URL}/ws/logs`);
    wsRef.current = ws;
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.event === "log") {
          const ev: LogEvent = { id: msg.id, timestamp: msg.timestamp, index: msg.index,
            source: msg.source, sourcetype: msg.sourcetype, host: msg.host,
            message: msg.message, severity: msg.severity, fields: msg.fields || {} };
          setLivePkts((p) => [ev, ...p].slice(0, 500));
        }
      } catch { /**/ }
    };
    ws.onerror = () => { setLiveMode(false); toast.error("Live tail disconnected"); };
    ws.onclose = () => { setLiveMode(false); };
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const fd = new FormData(); fd.append("file", file);
    try {
      const { data } = await api.post("/logs/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success(`Ingested ${data.accepted} events from ${file.name}`);
      handleSearch();
    } catch { toast.error("Upload failed"); }
    e.target.value = "";
  };

  const handleSync = async () => {
    try {
      const { data } = await api.post("/logs/sync");
      toast.success(`Synced ${data.synced} events`); handleSearch();
    } catch { toast.error("Sync failed"); }
  };

  const handleSave = async () => {
    if (!saveName) return;
    try {
      await api.post("/logs/saved", { name: saveName, query, time_range: timeRange });
      toast.success("Search saved"); setSaveModal(false); setSaveName("");
    } catch { toast.error("Save failed"); }
  };

  const addFilter = (field: string, value: string) => {
    const key = { host: "host", sourcetype: "sourcetype", severity: "severity", index: "index" }[field] || field;
    setQuery((q) => q === "*" ? `${key}="${value}"` : `${q} ${key}="${value}"`);
  };

  const exportCsv = () => {
    if (result?.type !== "events" || !result.events.length) return;
    const h = ["timestamp","severity","host","sourcetype","index","source","message"];
    const rows = result.events.map((e) => h.map((k) => JSON.stringify((e as any)[k] ?? "")).join(","));
    const blob = new Blob([[h.join(","), ...rows].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "events.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const displayEvents = liveMode ? livePkts : (result?.type === "events" ? result.events : []);
  const totalEvents   = result?.type === "events" ? result.total : 0;

  // ── Splunk-style toolbar button ───────────────────────────────────────────
  const TBtn = ({ onClick, title, children, active }: { onClick: () => void; title?: string; children: React.ReactNode; active?: boolean }) => (
    <button onClick={onClick} title={title}
      className={cn("flex items-center gap-1.5 rounded-sm border px-3 h-8 text-[11px] font-medium transition-colors",
        active
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
          : "hover:bg-white/5 hover:text-white"
      )}
      style={active ? {} : { borderColor: "hsl(var(--border))", color: "hsl(220 12% 52%)" }}
    >
      {children}
    </button>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar title="Search & Reporting" />

      {/* ── Splunk search bar area ────────────────────────────────────────── */}
      <div className="shrink-0 border-b px-4 py-3 space-y-2"
           style={{ background: "hsl(222 35% 11%)", borderColor: "hsl(var(--border))" }}>

        {/* Stats strip */}
        {logStats && (
          <div className="flex items-center gap-5 text-[10px] pb-1" style={{ color: "hsl(220 12% 46%)" }}>
            <span><span className="font-mono font-bold" style={{ color: "#8b5cf6" }}>{logStats.total_events.toLocaleString()}</span> total events</span>
            <span><span className="font-mono font-semibold" style={{ color: "hsl(220 18% 72%)" }}>{logStats.last_24h.toLocaleString()}</span> last 24h</span>
            {logStats.critical_24h > 0 && (
              <span className="text-red-400"><span className="font-mono font-semibold">{logStats.critical_24h}</span> critical/error</span>
            )}
            <span className="ml-auto font-mono" style={{ color: "hsl(220 12% 36%)" }}>
              SPL: <span style={{ color: "hsl(220 15% 55%)" }}>index=main severity=error | top host</span>
            </span>
          </div>
        )}

        {/* Search row */}
        <div className="flex items-center gap-2">
          {/* SPL input — Splunk green border on focus */}
          <div className="flex-1 flex items-center gap-0 spl-search h-9 px-3">
            <Search className="h-3.5 w-3.5 shrink-0 mr-2" style={{ color: "hsl(220 12% 44%)" }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSearch()}
              placeholder="Search events…   |   * | stats count by sourcetype   |   error | timechart count"
              className="flex-1 bg-transparent text-[12px] font-mono outline-none placeholder:text-[hsl(220_12%_30%)]"
              style={{ color: "hsl(220 18% 84%)" }}
            />
            {query !== "*" && query !== "" && (
              <button onClick={() => setQuery("*")} style={{ color: "hsl(220 12% 40%)" }}>
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Time picker */}
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value)}
            className="h-9 rounded-sm border px-3 text-[11px] outline-none focus:border-[#8b5cf6] cursor-pointer"
            style={{
              background: "hsl(222 40% 8%)",
              borderColor: "hsl(var(--border))",
              color: "hsl(220 14% 64%)",
            }}
          >
            {TIME_PRESETS.map((p) => <option key={p.value + p.label} value={p.value}>{p.label}</option>)}
          </select>

          {/* Search button — Splunk green */}
          <button
            onClick={handleSearch}
            disabled={running}
            className="h-9 flex items-center gap-1.5 rounded-sm px-5 text-[12px] font-semibold text-white disabled:opacity-50 transition-all"
            style={{ background: running ? "#5b21b6" : "#7c3aed" }}
          >
            {running ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            {running ? "Searching…" : "Search"}
          </button>

          <div className="w-px h-6 mx-1" style={{ background: "hsl(var(--border))" }} />

          <TBtn onClick={toggleLive} title="Live tail" active={liveMode}>
            {liveMode ? <Square className="h-3 w-3" /> : <Radio className="h-3 w-3" />}
            {liveMode ? "Stop" : "Live Tail"}
          </TBtn>

          <TBtn onClick={() => setSaveModal(true)} title="Save search">
            <Save className="h-3 w-3" />Save
          </TBtn>

          <TBtn onClick={() => fileRef.current?.click()} title="Upload log file">
            <Upload className="h-3 w-3" />Upload
          </TBtn>
          <input ref={fileRef} type="file" className="hidden" onChange={handleUpload} accept=".log,.txt,.json,.csv" />

          <TBtn onClick={handleSync} title="Sync internal data">
            <Database className="h-3 w-3" />Sync
          </TBtn>
        </div>
      </div>

      {/* ── Body: fields sidebar + results ───────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden min-h-0">

        {/* Field sidebar */}
        <aside className="w-44 shrink-0 border-r overflow-y-auto scrollbar-thin p-3"
               style={{ background: "hsl(222 35% 11%)", borderColor: "hsl(var(--border))" }}>
          <p className="text-[9px] font-bold uppercase tracking-widest mb-3"
             style={{ color: "hsl(220 12% 36%)" }}>Fields</p>

          {indexes.length > 0 && (
            <FieldFacet label="index" values={indexes.map((i) => [i.name, i.count])} onFilter={addFilter} />
          )}
          {sourcetypes.length > 0 && (
            <FieldFacet label="sourcetype" values={sourcetypes.map((s) => [s.name, s.count])} onFilter={addFilter} />
          )}
          {fieldFacets.host && Object.keys(fieldFacets.host).length > 0 && (
            <FieldFacet label="host" values={Object.entries(fieldFacets.host).sort((a, b) => b[1] - a[1])} onFilter={addFilter} />
          )}
          {fieldFacets.severity && Object.keys(fieldFacets.severity).length > 0 && (
            <FieldFacet label="severity" values={Object.entries(fieldFacets.severity).sort((a, b) => b[1] - a[1])} onFilter={addFilter} />
          )}

          {!indexes.length && !sourcetypes.length && (
            <div className="text-center py-8 space-y-2">
              <Database className="h-6 w-6 mx-auto opacity-20" style={{ color: "hsl(220 12% 50%)" }} />
              <p className="text-[10px]" style={{ color: "hsl(220 12% 38%)" }}>No data yet</p>
              <button onClick={handleSync}
                className="text-[10px] rounded-sm px-2 py-1 font-medium transition-colors hover:text-white"
                style={{ color: "#8b5cf6" }}>
                → Sync data
              </button>
            </div>
          )}
        </aside>

        {/* Results area */}
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">

          {/* Tabs (Splunk underline style) */}
          {(result || liveMode) && (
            <div className="flex items-center border-b shrink-0 px-4"
                 style={{ background: "hsl(222 32% 13%)", borderColor: "hsl(var(--border))" }}>
              {(["events", "statistics", "visualization"] as Tab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={cn("h-9 px-4 text-[11px] font-semibold capitalize border-b-2 transition-colors -mb-px")}
                  style={tab === t
                    ? { borderColor: "#8b5cf6", color: "#c4b5fd" }
                    : { borderColor: "transparent", color: "hsl(220 12% 48%)" }
                  }
                >
                  {t}
                </button>
              ))}

              <div className="ml-auto flex items-center gap-3 text-[10px]" style={{ color: "hsl(220 12% 44%)" }}>
                {liveMode && (
                  <span className="flex items-center gap-1.5 text-emerald-400">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="absolute animate-ping rounded-full bg-emerald-400 opacity-75 h-full w-full" />
                      <span className="relative rounded-full bg-emerald-500 h-1.5 w-1.5" />
                    </span>
                    Live · {livePkts.length} events
                  </span>
                )}
                {!liveMode && result && (
                  <span>
                    {result.type === "events"
                      ? `${totalEvents.toLocaleString()} events (showing ${result.events.length})`
                      : result.type === "stats"
                        ? `${result.rows.length} rows`
                        : `${result.rows.length} time buckets`}
                  </span>
                )}
                {result?.type === "events" && result.events.length > 0 && (
                  <button onClick={exportCsv} className="flex items-center gap-1 hover:text-white transition-colors">
                    <Download className="h-3 w-3" />CSV
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Content */}
          <div className="flex-1 overflow-y-auto scrollbar-thin min-h-0">

            {/* Empty state */}
            {!result && !liveMode && !running && (
              <div className="flex flex-col items-center justify-center h-full gap-5 text-center px-8">
                <Search className="h-12 w-12 opacity-10" style={{ color: "#8b5cf6" }} />
                <div>
                  <p className="text-sm font-semibold mb-1" style={{ color: "hsl(220 18% 78%)" }}>
                    Search your logs with SPL
                  </p>
                  <p className="text-xs" style={{ color: "hsl(220 12% 44%)" }}>
                    Enter a query above and press Search or ↵ Enter
                  </p>
                </div>
                <div className="rounded border p-4 text-left space-y-1.5 text-[11px] font-mono max-w-md"
                     style={{ background: "hsl(222 40% 8%)", borderColor: "hsl(var(--border))" }}>
                  {[
                    ["*", "all events"],
                    ["error", "keyword search"],
                    ["severity=critical", "field match"],
                    ["* | stats count by host", "group by field"],
                    ["* | timechart count by severity", "time chart"],
                    ["* | top 10 sourcetype", "top values"],
                  ].map(([q, desc]) => (
                    <p key={q} className="cursor-pointer hover:opacity-80" onClick={() => setQuery(q)}>
                      <span style={{ color: "#8b5cf6" }}>{q}</span>
                      <span style={{ color: "hsl(220 12% 36%)" }}>  —  </span>
                      <span style={{ color: "hsl(220 14% 52%)" }}>{desc}</span>
                    </p>
                  ))}
                </div>
                <button onClick={handleSync}
                  className="flex items-center gap-2 rounded-sm px-4 py-2 text-xs font-semibold text-white transition-colors hover:opacity-90"
                  style={{ background: "#8b5cf6" }}>
                  <Database className="h-3.5 w-3.5" />Import existing app data
                </button>
              </div>
            )}

            {/* Loading */}
            {running && (
              <div className="flex items-center justify-center h-full gap-2 text-sm" style={{ color: "hsl(220 12% 48%)" }}>
                <RefreshCw className="h-4 w-4 animate-spin" />Searching…
              </div>
            )}

            {/* Column headers for events */}
            {tab === "events" && (result?.type === "events" || liveMode) && displayEvents.length > 0 && (
              <div className="flex items-center text-[9px] font-bold uppercase tracking-widest border-b px-0 py-1.5 sticky top-0 z-10"
                   style={{ background: "hsl(222 35% 12%)", borderColor: "hsl(var(--border))", color: "hsl(220 12% 38%)" }}>
                <div className="w-1" />
                <div className="w-9 text-center">#</div>
                <div className="w-5" />
                <div className="w-36">Time</div>
                <div className="w-20">Severity</div>
                <div className="w-28">Host</div>
                <div className="w-32">Source type</div>
                <div className="flex-1">Event</div>
              </div>
            )}

            {/* Events */}
            {tab === "events" && (result?.type === "events" || liveMode) && (
              displayEvents.length === 0
                ? (
                  <div className="flex flex-col items-center justify-center h-48 gap-2">
                    <FileText className="h-8 w-8 opacity-20" style={{ color: "hsl(220 12% 50%)" }} />
                    <p className="text-xs" style={{ color: "hsl(220 12% 44%)" }}>
                      {liveMode ? "Waiting for events…" : "No events matched your search"}
                    </p>
                  </div>
                )
                : displayEvents.map((ev, i) => <EventRow key={ev.id} ev={ev} num={i + 1} />)
            )}

            {/* Statistics tab */}
            {tab === "statistics" && result?.type === "stats" && (
              <div className="p-4">
                <div className="rounded border overflow-hidden" style={{ borderColor: "hsl(var(--border))" }}>
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="border-b" style={{ background: "hsl(222 35% 12%)", borderColor: "hsl(var(--border))" }}>
                        {result.columns.map((col) => (
                          <th key={col} className="px-4 py-2.5 text-left text-[9px] font-bold uppercase tracking-widest"
                              style={{ color: "hsl(220 12% 44%)" }}>{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.map((row, i) => (
                        <tr key={i} className="border-b spl-row" style={{ borderColor: "hsl(var(--border))" }}>
                          {result.columns.map((col) => (
                            <td key={col} className="px-4 py-2 font-mono" style={{ color: "hsl(220 18% 78%)" }}>
                              {row[col] != null ? String(row[col]) : "—"}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Visualization tab */}
            {tab === "visualization" && result && (
              <div className="p-4">
                <div className="rounded border p-5" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
                  <Visualization result={result} />
                </div>
              </div>
            )}

            {/* Wrong tab redirects */}
            {tab === "events" && result?.type === "stats" && (
              <div className="flex flex-col items-center justify-center h-48 gap-2">
                <p className="text-xs" style={{ color: "hsl(220 12% 44%)" }}>This search returned statistics.</p>
                <button onClick={() => setTab("statistics")} className="text-xs" style={{ color: "#8b5cf6" }}>
                  Switch to Statistics tab →
                </button>
              </div>
            )}
            {tab === "events" && result?.type === "timechart" && (
              <div className="flex flex-col items-center justify-center h-48 gap-2">
                <p className="text-xs" style={{ color: "hsl(220 12% 44%)" }}>This search returned a time chart.</p>
                <button onClick={() => setTab("visualization")} className="text-xs" style={{ color: "#8b5cf6" }}>
                  Switch to Visualization tab →
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Save modal */}
      {saveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-96 rounded border p-6 shadow-2xl"
               style={{ background: "hsl(222 32% 14%)", borderColor: "hsl(var(--border))" }}>
            <h2 className="text-sm font-semibold mb-4" style={{ color: "hsl(220 18% 84%)" }}>Save Search</h2>
            <input
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
              placeholder="Search name…"
              autoFocus
              className="w-full rounded-sm border px-3 py-2 text-sm mb-3 outline-none"
              style={{
                background: "hsl(222 40% 9%)",
                borderColor: "hsl(var(--border))",
                color: "hsl(220 18% 84%)",
              }}
            />
            <p className="text-[10px] font-mono mb-1" style={{ color: "#8b5cf6" }}>{query}</p>
            <p className="text-[10px] mb-5" style={{ color: "hsl(220 12% 44%)" }}>Time: {timeRange}</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setSaveModal(false)}
                className="rounded-sm border px-4 py-1.5 text-xs transition-colors hover:bg-white/5"
                style={{ borderColor: "hsl(var(--border))", color: "hsl(220 12% 52%)" }}>
                Cancel
              </button>
              <button onClick={handleSave}
                className="rounded-sm px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:opacity-90"
                style={{ background: "#8b5cf6" }}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
