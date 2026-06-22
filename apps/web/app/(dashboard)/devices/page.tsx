"use client";
import { useState, useCallback } from "react";
import useSWR from "swr";
import { api } from "@/lib/api";
import { TopBar } from "@/components/layout/TopBar";
import { SeverityBadge } from "@/components/ui/SeverityBadge";
import { cn, timeAgo } from "@/lib/utils";
import { DeviceIcon } from "@/components/ui/DeviceIcon";
import { Search, RefreshCw, ShieldOff, Shield, ChevronLeft, ChevronRight, Monitor } from "lucide-react";
import toast from "react-hot-toast";
import { useWebSocket } from "@/hooks/useWebSocket";

const fetcher = (url: string) => api.get(url).then((r) => r.data);

const STATUS_DOT: Record<string, string> = {
  online:  "bg-green-500",
  offline: "bg-zinc-400",
  unknown: "bg-yellow-500",
};

const CATEGORIES = ["all", "computer", "mobile", "iot", "network", "media", "guest", "unknown"];

function Skeleton() {
  return (
    <>
      {Array.from({ length: 10 }).map((_, i) => (
        <tr key={i}>
          {Array.from({ length: 8 }).map((_, j) => (
            <td key={j} className="px-4 py-3">
              <div className="h-3.5 w-full animate-pulse rounded bg-muted" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export default function DevicesPage() {
  const [search, setSearch]           = useState("");
  const [category, setCategory]       = useState("all");
  const [statusFilter, setStatus]     = useState("all");
  const [page, setPage]               = useState(1);
  const PER_PAGE = 50;

  const params = new URLSearchParams({ page: String(page), limit: String(PER_PAGE) });
  if (search)                   params.set("search", search);
  if (category !== "all")       params.set("category", category);
  if (statusFilter !== "all")   params.set("status", statusFilter);

  const { data, mutate, isLoading } = useSWR(`/devices?${params}`, fetcher, { refreshInterval: 8_000 });
  const { connected } = useWebSocket("/ws/devices", useCallback(() => { mutate(); }, [mutate]));

  const handleBlock = async (id: string, blocked: boolean) => {
    try {
      await api.post(`/devices/${id}/block`, { blocked });
      mutate();
      toast.success(blocked ? "Device blocked" : "Device unblocked");
    } catch {
      toast.error("Failed to update device");
    }
  };

  const handleScan = async () => {
    try {
      await api.post("/scans?scan_type=arp");
      toast.success("Scan queued");
    } catch {
      toast.error("Scan failed to start");
    }
  };

  const totalPages = Math.ceil((data?.total ?? 0) / PER_PAGE);

  const actions = (
    <button
      onClick={handleScan}
      className="flex items-center gap-1.5 rounded-md border border-border bg-muted px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
    >
      <RefreshCw className="h-3 w-3" />
      Scan Network
    </button>
  );

  return (
    <div className="flex flex-col overflow-hidden">
      <TopBar
        title="Devices"
        subtitle={data ? `${data.online} online · ${data.offline} offline` : undefined}
        actions={actions}
        live={connected}
      />

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="space-y-4 p-5">

          {/* ── Summary chips ────────────────────────────────────────── */}
          <div className="flex flex-wrap items-center gap-2">
            {[
              { label: "Total",    value: data?.total    ?? "—", color: "text-foreground" },
              { label: "Online",   value: data?.online   ?? "—", color: "text-green-500" },
              { label: "Offline",  value: data?.offline  ?? "—", color: "text-muted-foreground" },
              { label: "New today",value: data?.new_today ?? "—", color: "text-brand-500 dark:text-brand-400" },
            ].map((s) => (
              <div key={s.label} className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs">
                <span className={cn("font-semibold tabular-nums", s.color)}>{s.value}</span>
                <span className="text-muted-foreground">{s.label}</span>
              </div>
            ))}

            {/* Filters */}
            <div className="ml-auto flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search…"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                  className="h-7 w-44 rounded-md border border-border bg-muted pl-7 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/30"
                />
              </div>

              <select
                value={category}
                onChange={(e) => { setCategory(e.target.value); setPage(1); }}
                className="h-7 rounded-md border border-border bg-muted px-2 text-xs text-foreground focus:outline-none"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c === "all" ? "All categories" : c.charAt(0).toUpperCase() + c.slice(1)}</option>
                ))}
              </select>

              <select
                value={statusFilter}
                onChange={(e) => { setStatus(e.target.value); setPage(1); }}
                className="h-7 rounded-md border border-border bg-muted px-2 text-xs text-foreground focus:outline-none"
              >
                <option value="all">All status</option>
                <option value="online">Online</option>
                <option value="offline">Offline</option>
              </select>
            </div>
          </div>

          {/* ── Table ────────────────────────────────────────────────── */}
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    {["Device", "IP", "MAC", "Vendor / OS", "Status", "Last Seen", "Risk", ""].map((h) => (
                      <th key={h} className="whitespace-nowrap px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {isLoading
                    ? <Skeleton />
                    : (data?.items as any[] | undefined)?.length
                    ? (data.items as any[]).map((d: any) => (
                        <tr key={d.id} className="group hover:bg-accent/30 transition-colors">
                          {/* Device */}
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2.5">
                              <DeviceIcon category={d.category} size="sm" />
                              <div>
                                <p className="font-medium text-foreground">
                                  {d.display_name || d.hostname || (
                                    <span className="italic text-muted-foreground">Unknown</span>
                                  )}
                                </p>
                                {d.os_guess && <p className="text-muted-foreground">{d.os_guess}</p>}
                              </div>
                              {d.is_trusted && <Shield className="h-3 w-3 shrink-0 text-green-500" aria-label="Trusted" />}
                            </div>
                          </td>
                          {/* IP */}
                          <td className="px-4 py-3 font-mono text-foreground">{d.ip_address ?? "—"}</td>
                          {/* MAC */}
                          <td className="px-4 py-3 font-mono text-muted-foreground">{d.mac_address}</td>
                          {/* Vendor / OS */}
                          <td className="px-4 py-3 text-muted-foreground">{d.vendor ?? "—"}</td>
                          {/* Status */}
                          <td className="px-4 py-3">
                            <span className="flex items-center gap-1.5">
                              <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[d.status] ?? "bg-muted-foreground")} />
                              <span className="capitalize text-foreground">{d.status}</span>
                            </span>
                          </td>
                          {/* Last seen */}
                          <td className="px-4 py-3 text-muted-foreground">
                            {d.last_seen_at ? timeAgo(d.last_seen_at) : "Never"}
                          </td>
                          {/* Risk */}
                          <td className="px-4 py-3">
                            {d.risk_score > 0 ? (
                              <span className={cn(
                                "inline-flex h-5 min-w-[28px] items-center justify-center rounded px-1 text-[11px] font-bold tabular-nums",
                                d.risk_score >= 70 ? "bg-red-500/15 text-red-500" :
                                d.risk_score >= 40 ? "bg-orange-500/15 text-orange-500" :
                                                     "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400"
                              )}>
                                {d.risk_score}
                              </span>
                            ) : (
                              <span className="text-muted-foreground/40">—</span>
                            )}
                          </td>
                          {/* Actions */}
                          <td className="px-4 py-3">
                            <button
                              onClick={() => handleBlock(d.id, !d.is_blocked)}
                              className={cn(
                                "invisible flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors group-hover:visible",
                                d.is_blocked
                                  ? "bg-green-500/12 text-green-600 dark:text-green-400 hover:bg-green-500/20"
                                  : "bg-red-500/12 text-red-500 hover:bg-red-500/20"
                              )}
                            >
                              {d.is_blocked ? <Shield className="h-2.5 w-2.5" /> : <ShieldOff className="h-2.5 w-2.5" />}
                              {d.is_blocked ? "Unblock" : "Block"}
                            </button>
                          </td>
                        </tr>
                      ))
                    : (
                      <tr>
                        <td colSpan={8} className="px-4 py-16 text-center">
                          <Monitor className="mx-auto mb-3 h-10 w-10 text-muted-foreground/20" />
                          <p className="text-sm font-medium text-muted-foreground">No devices found</p>
                          <p className="mt-1 text-xs text-muted-foreground/70">Run a network scan to discover devices</p>
                        </td>
                      </tr>
                    )
                  }
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
                <span>{data?.total} devices</span>
                <div className="flex items-center gap-1">
                  <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1}
                    className="flex h-6 w-6 items-center justify-center rounded hover:bg-accent disabled:opacity-30">
                    <ChevronLeft className="h-3 w-3" />
                  </button>
                  <span className="px-2">Page {page} of {totalPages}</span>
                  <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page === totalPages}
                    className="flex h-6 w-6 items-center justify-center rounded hover:bg-accent disabled:opacity-30">
                    <ChevronRight className="h-3 w-3" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

