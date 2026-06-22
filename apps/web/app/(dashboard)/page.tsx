"use client";
import useSWR from "swr";
import { api } from "@/lib/api";
import { TopBar } from "@/components/layout/TopBar";
import { StatCard } from "@/components/ui/StatCard";
import { BandwidthChart } from "@/components/charts/BandwidthChart";
import { AlertsDonut } from "@/components/charts/AlertsDonut";
import { SeverityBadge } from "@/components/ui/SeverityBadge";
import { formatMbps, formatBytes, timeAgo } from "@/lib/utils";
import { DeviceIcon } from "@/components/ui/DeviceIcon";
import { MonitorCheck, ArrowDownUp, ShieldAlert, Globe2 } from "lucide-react";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useState, useCallback, useEffect } from "react";
import Link from "next/link";

const fetcher = (url: string) => api.get(url).then((r) => r.data);

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-muted ${className}`} />;
}

export default function OverviewPage() {
  const { data: devices }    = useSWR("/devices?limit=50",           fetcher, { refreshInterval: 30_000 });
  const { data: traffic }    = useSWR("/traffic/overview?hours=24",  fetcher, { refreshInterval: 15_000 });
  const { data: alerts }     = useSWR("/alerts?hours=24&limit=8",    fetcher, { refreshInterval: 10_000 });
  const { data: alertStats } = useSWR("/alerts/stats?hours=24",      fetcher, { refreshInterval: 15_000 });
  const { data: dns }        = useSWR("/dns/overview?hours=24",      fetcher, { refreshInterval: 30_000 });

  const [liveMbps, setLiveMbps] = useState<{ in: number; out: number } | null>(null);
  const { connected } = useWebSocket("/ws/live-traffic", useCallback((d: unknown) => {
    const msg = d as { bytes_in?: number; bytes_out?: number };
    if (msg.bytes_in !== undefined)
      setLiveMbps({ in: (msg.bytes_in / 60) * 8 / 1e6, out: (msg.bytes_out ?? 0) / 60 * 8 / 1e6 });
  }, []));

  const mbpsIn  = liveMbps?.in  ?? traffic?.summary?.current_mbps_in  ?? 0;
  const mbpsOut = liveMbps?.out ?? traffic?.summary?.current_mbps_out ?? 0;
  const criticalCount = (alertStats?.critical ?? 0) + (alertStats?.high ?? 0);

  return (
    <div className="flex flex-col overflow-hidden">
      <TopBar title="Overview" live={connected} />

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="space-y-6 p-5">

          {/* ── Stats ──────────────────────────────────────────────────── */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              title="Devices Online"
              value={devices ? devices.online : "—"}
              sub={devices ? `${devices.total} total · ${devices.new_today} new today` : "Loading…"}
              icon={MonitorCheck}
              accent="brand"
            />
            <StatCard
              title="Download"
              value={formatMbps(mbpsIn)}
              sub={`↑ ${formatMbps(mbpsOut)} upload`}
              icon={ArrowDownUp}
              accent="blue"
            />
            <StatCard
              title="Open Alerts"
              value={alertStats ? (criticalCount || Object.values(alertStats as Record<string,number>).reduce((a,b)=>a+b,0)) : "—"}
              sub={criticalCount > 0 ? "critical or high" : "last 24 hours"}
              icon={ShieldAlert}
              accent={criticalCount > 0 ? "red" : "green"}
            />
            <StatCard
              title="DNS Queries"
              value={dns?.total?.toLocaleString() ?? "—"}
              sub={dns ? `${dns.block_rate}% blocked · ${dns.malicious} malicious` : "Loading…"}
              icon={Globe2}
              accent="violet"
            />
          </div>

          {/* ── Bandwidth + Alerts ─────────────────────────────────────── */}
          <div className="grid gap-4 lg:grid-cols-3">

            <div className="rounded-xl border border-border bg-card p-5 lg:col-span-2">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Network Bandwidth</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">Last 24 hours</p>
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-violet-500" />Download
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />Upload
                  </span>
                </div>
              </div>
              {traffic?.timeseries
                ? <BandwidthChart data={traffic.timeseries} height={200} />
                : <div className="flex h-[200px] flex-col gap-2 pt-4"><Skeleton className="h-full w-full" /></div>
              }
            </div>

            <div className="rounded-xl border border-border bg-card p-5">
              <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Alert Breakdown</p>
              <p className="mb-1 text-xs text-muted-foreground">Last 24 hours</p>
              <AlertsDonut data={alertStats ?? {}} />
              <div className="mt-3 space-y-1.5">
                {Object.entries(alertStats ?? {}).map(([sev, count]) => (
                  <div key={sev} className="flex items-center justify-between text-xs">
                    <SeverityBadge severity={sev} />
                    <span className="font-mono tabular-nums text-muted-foreground">{count as number}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── Alerts + Top Talkers ───────────────────────────────────── */}
          <div className="grid gap-4 lg:grid-cols-3">

            <div className="rounded-xl border border-border bg-card lg:col-span-2">
              <div className="flex items-center justify-between border-b border-border px-5 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Recent Alerts</p>
                <Link href="/threats" className="text-xs text-brand-500 hover:underline dark:text-brand-400">View all →</Link>
              </div>
              {(alerts as any[] | undefined)?.length ? (
                <div className="divide-y divide-border">
                  {(alerts as any[]).map((a: any) => (
                    <div key={a.id} className="flex items-start gap-3 px-5 py-3 hover:bg-accent/40 transition-colors">
                      <SeverityBadge severity={a.severity} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">{a.title}</p>
                        {a.ai_explanation && (
                          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{a.ai_explanation}</p>
                        )}
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(a.triggered_at)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex h-36 flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
                  <ShieldAlert className="h-8 w-8 text-muted-foreground/30" />
                  No alerts in the last 24 hours
                </div>
              )}
            </div>

            <div className="rounded-xl border border-border bg-card">
              <div className="border-b border-border px-5 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Top Bandwidth Users</p>
              </div>
              <div className="space-y-4 p-5">
                {(traffic?.top_talkers as any[] | undefined)?.map((t: any) => (
                  <div key={t.device_id} className="text-xs">
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <span className="truncate font-medium text-foreground">{t.device_name}</span>
                      <span className="shrink-0 font-mono text-muted-foreground">{t.percentage}%</span>
                    </div>
                    <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${t.percentage}%` }} />
                    </div>
                    <div className="mt-1 flex justify-between text-muted-foreground">
                      <span>↓ {formatBytes(t.bytes_in)}</span>
                      <span>↑ {formatBytes(t.bytes_out)}</span>
                    </div>
                  </div>
                )) ?? <Skeleton className="h-32 w-full" />}
              </div>
            </div>
          </div>

          {/* ── Online devices grid ────────────────────────────────────── */}
          <Section
            title="Online Devices"
            action={<Link href="/devices" className="text-xs text-brand-500 hover:underline dark:text-brand-400">View all →</Link>}
          >
            {devices?.items?.length ? (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {(devices.items as any[]).filter((d: any) => d.status === "online").map((d: any) => (
                  <div key={d.id} className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 hover:border-brand-500/30 transition-colors">
                    <DeviceIcon category={d.category} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-foreground">
                        {d.display_name || d.hostname || d.mac_address}
                      </p>
                      <p className="font-mono text-[11px] text-muted-foreground">{d.ip_address}</p>
                    </div>
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-green-500" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
              </div>
            )}
          </Section>

        </div>
      </div>
    </div>
  );
}
