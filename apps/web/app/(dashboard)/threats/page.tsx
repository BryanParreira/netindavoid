"use client";
import { useState } from "react";
import useSWR from "swr";
import { api } from "@/lib/api";
import { TopBar } from "@/components/layout/TopBar";
import { SeverityBadge } from "@/components/ui/SeverityBadge";
import { timeAgo, cn } from "@/lib/utils";
import { BotMessageSquare, CheckCircle, Eye, Shield, X, ArrowRight } from "lucide-react";
import Link from "next/link";
import toast from "react-hot-toast";

const fetcher = (url: string) => api.get(url).then((r) => r.data);

const SEVERITIES = ["critical", "high", "medium", "low", "info"];

export default function ThreatsPage() {
  const [severity, setSeverity] = useState("");
  const [hours, setHours]       = useState(24);
  const [selected, setSelected] = useState<any | null>(null);

  const params = new URLSearchParams({ hours: String(hours) });
  if (severity) params.set("severity", severity);

  const { data: alerts, mutate } = useSWR(`/alerts?${params}`, fetcher, { refreshInterval: 5_000 });
  const { data: stats }         = useSWR(`/alerts/stats?hours=${hours}`, fetcher, { refreshInterval: 15_000 });

  const ack = async (id: string) => {
    await api.post(`/alerts/${id}/acknowledge`, {});
    mutate();
    toast.success("Alert acknowledged");
  };

  const resolve = async (id: string) => {
    await api.post(`/alerts/${id}/resolve`);
    mutate();
    setSelected(null);
    toast.success("Alert resolved");
  };

  const list = (alerts ?? []) as any[];

  return (
    <div className="flex flex-col overflow-hidden">
      <TopBar
        title="Threats & Alerts"
        subtitle={`${list.length} in last ${hours}h`}
        live
      />

      <div className="flex flex-1 overflow-hidden">
        {/* ── List panel ─────────────────────────────────────────────── */}
        <div className="flex flex-1 flex-col overflow-hidden">

          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
            {/* Severity quick-filter chips */}
            <button
              onClick={() => setSeverity("")}
              className={cn(
                "rounded-full px-3 py-1 text-[11px] font-semibold transition-colors",
                severity === "" ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground"
              )}
            >
              All
            </button>
            {SEVERITIES.map((s) => (
              <button
                key={s}
                onClick={() => setSeverity(severity === s ? "" : s)}
                className={cn(
                  "rounded-full px-3 py-1 text-[11px] font-semibold transition-colors",
                  severity === s ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground"
                )}
              >
                {s.charAt(0).toUpperCase() + s.slice(1)}
                {stats?.[s] != null && (
                  <span className="ml-1.5 tabular-nums">{stats[s]}</span>
                )}
              </button>
            ))}

            <select
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
              className="ml-auto h-7 rounded-md border border-border bg-muted px-2 text-xs text-foreground focus:outline-none"
            >
              {[1, 6, 24, 72, 168].map((h) => (
                <option key={h} value={h}>Last {h}h</option>
              ))}
            </select>
          </div>

          {/* Alerts */}
          <div className="flex-1 overflow-y-auto scrollbar-thin divide-y divide-border">
            {list.length === 0 ? (
              <div className="flex h-64 flex-col items-center justify-center gap-3">
                <Shield className="h-10 w-10 text-muted-foreground/20" />
                <p className="text-sm text-muted-foreground">No alerts matching filters</p>
              </div>
            ) : (
              list.map((a: any) => (
                <div
                  key={a.id}
                  onClick={() => setSelected(a)}
                  className={cn(
                    "group cursor-pointer px-4 py-3 transition-colors hover:bg-accent/30",
                    selected?.id === a.id && "bg-accent/50 border-l-2 border-l-brand-500"
                  )}
                >
                  <div className="flex items-start gap-3">
                    <SeverityBadge severity={a.severity} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium text-foreground">{a.title}</p>
                        <Link
                          href={`/threats/${a.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="invisible ml-auto shrink-0 flex items-center gap-0.5 text-[11px] text-brand-500 dark:text-brand-400 hover:underline group-hover:visible"
                        >
                          Detail <ArrowRight className="h-2.5 w-2.5" />
                        </Link>
                      </div>
                      <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{a.description}</p>
                    </div>
                    <div className="shrink-0 text-right text-xs">
                      <p className="text-muted-foreground">{timeAgo(a.triggered_at)}</p>
                      <p className={cn(
                        "mt-0.5 font-medium capitalize",
                        a.status === "open" ? "text-orange-500" :
                        a.status === "acknowledged" ? "text-yellow-500" :
                        "text-green-500"
                      )}>
                        {a.status}
                      </p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ── Detail panel ───────────────────────────────────────────── */}
        {selected && (
          <div className="w-[380px] shrink-0 overflow-y-auto scrollbar-thin border-l border-border bg-card">
            <div className="sticky top-0 flex items-center justify-between border-b border-border bg-card px-5 py-3">
              <SeverityBadge severity={selected.severity} />
              <button
                onClick={() => setSelected(null)}
                className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="p-5 space-y-5">
              <div>
                <h2 className="text-sm font-semibold text-foreground">{selected.title}</h2>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{selected.description}</p>
              </div>

              {selected.ai_explanation && (
                <div className="rounded-lg border border-brand-500/25 bg-brand-500/8 p-3.5">
                  <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-brand-500 dark:text-brand-400">
                    <BotMessageSquare className="h-3.5 w-3.5" />
                    AI Explanation
                  </div>
                  <p className="text-xs leading-relaxed text-foreground">{selected.ai_explanation}</p>
                </div>
              )}

              <div className="space-y-2.5 text-xs">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Details</p>
                {[
                  ["Category",  selected.category],
                  ["Source",    selected.source],
                  ["Time",      new Date(selected.triggered_at).toLocaleString()],
                  ["Status",    selected.status],
                  selected.suricata_signature && ["Signature", selected.suricata_signature],
                ].filter(Boolean).map(([k, v]) => (
                  <div key={k as string} className="flex items-start justify-between gap-4">
                    <span className="shrink-0 text-muted-foreground">{k}</span>
                    <span className="break-all text-right font-mono text-foreground">{v}</span>
                  </div>
                ))}
              </div>

              {selected.status === "open" && (
                <div className="flex gap-2 pt-2">
                  <button
                    onClick={() => ack(selected.id)}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-muted px-3 py-2 text-xs font-medium hover:bg-accent"
                  >
                    <Eye className="h-3.5 w-3.5" /> Acknowledge
                  </button>
                  <button
                    onClick={() => resolve(selected.id)}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-green-500/30 bg-green-500/12 px-3 py-2 text-xs font-medium text-green-600 dark:text-green-400 hover:bg-green-500/20"
                  >
                    <CheckCircle className="h-3.5 w-3.5" /> Resolve
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
