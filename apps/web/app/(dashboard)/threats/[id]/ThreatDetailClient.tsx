"use client";
import { use } from "react";
import useSWR from "swr";
import { api } from "@/lib/api";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { TopBar } from "@/components/layout/TopBar";
import { SeverityBadge } from "@/components/ui/SeverityBadge";
import { DeviceIcon } from "@/components/ui/DeviceIcon";
import { cn, timeAgo } from "@/lib/utils";
import {
  ArrowLeft, BotMessageSquare, CheckCircle, Eye, Clock,
  Terminal, Shield, AlertTriangle, CheckCheck, ChevronRight,
} from "lucide-react";
import toast from "react-hot-toast";

const fetcher = (url: string) => api.get(url).then((r) => r.data);

const STATUS_CFG: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  open:         { label: "Open",         icon: AlertTriangle, color: "text-orange-500" },
  acknowledged: { label: "Acknowledged", icon: Eye,           color: "text-yellow-500" },
  resolved:     { label: "Resolved",     icon: CheckCheck,    color: "text-green-500" },
};

const SEVERITY_BANNER: Record<string, string> = {
  critical: "border-red-500/30 bg-red-500/6",
  high:     "border-orange-500/30 bg-orange-500/6",
  medium:   "border-yellow-500/30 bg-yellow-500/6",
  low:      "border-green-500/30 bg-green-500/6",
  info:     "border-blue-500/30 bg-blue-500/6",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}

export function ThreatDetailClient({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router  = useRouter();
  const { data: alert, mutate, isLoading } = useSWR(`/alerts/${id}`, fetcher);

  const ack = async () => {
    await api.post(`/alerts/${id}/acknowledge`, {});
    mutate();
    toast.success("Alert acknowledged");
  };

  const resolve = async () => {
    await api.post(`/alerts/${id}/resolve`);
    mutate();
    toast.success("Alert resolved");
  };

  if (isLoading) {
    return (
      <div className="flex flex-col overflow-hidden">
        <TopBar title="Loading…" />
        <div className="flex-1 p-5 space-y-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-12 w-full animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      </div>
    );
  }

  if (!alert) {
    return (
      <div className="flex flex-col overflow-hidden">
        <TopBar title="Alert not found" />
        <div className="flex h-64 flex-col items-center justify-center gap-3">
          <Shield className="h-10 w-10 text-muted-foreground/20" />
          <p className="text-sm text-muted-foreground">This alert no longer exists or was deleted.</p>
          <Link href="/threats" className="text-xs text-brand-500 hover:underline">← Back to Threats</Link>
        </div>
      </div>
    );
  }

  const statusCfg = STATUS_CFG[alert.status] ?? STATUS_CFG.open;
  const StatusIcon = statusCfg.icon;
  const device = alert.affected_device;

  return (
    <div className="flex flex-col overflow-hidden">
      <TopBar
        title="Threat Detail"
        actions={
          <button
            onClick={() => router.back()}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-3 w-3" /> Back
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="mx-auto max-w-5xl space-y-5 p-5">

          <div className={cn("rounded-xl border p-5", SEVERITY_BANNER[alert.severity] ?? SEVERITY_BANNER.info)}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <SeverityBadge severity={alert.severity} />
                  <span className="text-[11px] text-muted-foreground capitalize">{alert.category.replace("_", " ")}</span>
                  <span className="text-muted-foreground/40">·</span>
                  <span className="text-[11px] text-muted-foreground">{alert.source}</span>
                </div>
                <h1 className="text-lg font-semibold text-foreground">{alert.title}</h1>
                <p className="mt-1.5 text-sm text-muted-foreground">{alert.description}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-3">
                <div className={cn("flex items-center gap-1.5 text-xs font-semibold", statusCfg.color)}>
                  <StatusIcon className="h-3.5 w-3.5" />
                  {statusCfg.label}
                </div>
                {alert.status === "open" && (
                  <div className="flex gap-2">
                    <button
                      onClick={ack}
                      className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors"
                    >
                      <Eye className="h-3 w-3" /> Acknowledge
                    </button>
                    <button
                      onClick={resolve}
                      className="flex items-center gap-1.5 rounded-lg border border-green-500/30 bg-green-500/12 px-3 py-1.5 text-xs font-medium text-green-600 dark:text-green-400 hover:bg-green-500/20 transition-colors"
                    >
                      <CheckCircle className="h-3 w-3" /> Resolve
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            <div className="space-y-5 lg:col-span-2">

              {alert.ai_explanation && (
                <Section title="AI Analysis">
                  <div className="rounded-xl border border-brand-500/20 bg-brand-500/6 p-4">
                    <div className="mb-2.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-brand-500 dark:text-brand-400">
                      <BotMessageSquare className="h-3.5 w-3.5" />
                      Plain-language explanation
                    </div>
                    <p className="text-sm leading-relaxed text-foreground">{alert.ai_explanation}</p>
                  </div>
                </Section>
              )}

              {alert.remediation_steps?.length > 0 && (
                <Section title="Recommended Actions">
                  <div className="rounded-xl border border-border bg-card divide-y divide-border">
                    {alert.remediation_steps.map((step: string, i: number) => (
                      <div key={i} className="flex items-start gap-3 px-4 py-3">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-500/12 text-[10px] font-bold text-brand-500 dark:text-brand-400">
                          {i + 1}
                        </span>
                        <p className="text-sm text-foreground">{step}</p>
                        <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {alert.raw_data && (
                <Section title="Raw Evidence">
                  <div className="rounded-xl border border-border bg-card overflow-hidden">
                    <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
                      <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Event payload</span>
                    </div>
                    <pre className="overflow-x-auto p-4 text-[11px] leading-relaxed text-foreground font-mono scrollbar-thin">
                      {JSON.stringify(alert.raw_data, null, 2)}
                    </pre>
                  </div>
                </Section>
              )}
            </div>

            <div className="space-y-5">

              <Section title="Timeline">
                <div className="rounded-xl border border-border bg-card divide-y divide-border">
                  {[
                    { label: "Triggered",     ts: alert.triggered_at,    show: true },
                    { label: "Acknowledged",  ts: alert.acknowledged_at, show: !!alert.acknowledged_at },
                    { label: "Resolved",      ts: alert.resolved_at,     show: !!alert.resolved_at },
                  ].filter((e) => e.show).map((e) => (
                    <div key={e.label} className="flex items-center justify-between px-4 py-3 text-xs">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {e.label}
                      </div>
                      <span className="font-mono text-foreground">{timeAgo(e.ts)}</span>
                    </div>
                  ))}
                </div>
              </Section>

              {device && (
                <Section title="Affected Device">
                  <Link
                    href={`/devices`}
                    className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 hover:border-brand-500/40 transition-colors"
                  >
                    <DeviceIcon category={device.category} size="md" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">
                        {device.display_name || device.hostname || device.mac_address}
                      </p>
                      <p className="font-mono text-[11px] text-muted-foreground">{device.ip_address}</p>
                      {device.vendor && <p className="text-[11px] text-muted-foreground">{device.vendor}</p>}
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
                  </Link>
                  {alert.related_alert_count > 0 && (
                    <p className="mt-2 text-center text-[11px] text-muted-foreground">
                      +{alert.related_alert_count} related alert{alert.related_alert_count !== 1 ? "s" : ""} on this device
                    </p>
                  )}
                </Section>
              )}

              <Section title="Details">
                <div className="rounded-xl border border-border bg-card divide-y divide-border">
                  {[
                    ["Alert ID",  alert.id.slice(0, 8) + "…"],
                    ["Category",  alert.category.replace("_", " ")],
                    ["Source",    alert.source],
                    alert.suricata_signature && ["IDS Rule", alert.suricata_signature],
                    alert.suricata_sid && ["SID", String(alert.suricata_sid)],
                  ].filter(Boolean).map(([k, v]) => (
                    <div key={k as string} className="flex items-start justify-between gap-3 px-4 py-2.5 text-xs">
                      <span className="shrink-0 text-muted-foreground">{k}</span>
                      <span className="break-all text-right font-mono text-foreground">{v}</span>
                    </div>
                  ))}
                </div>
              </Section>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
