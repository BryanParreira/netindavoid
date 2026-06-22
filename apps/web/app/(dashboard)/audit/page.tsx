"use client";
import { useState } from "react";
import useSWR from "swr";
import { api } from "@/lib/api";
import { TopBar } from "@/components/layout/TopBar";
import { cn } from "@/lib/utils";
import {
  Search, Shield, ShieldAlert, ShieldCheck, Globe, Lock, Wifi,
  AlertTriangle, CheckCircle, XCircle, ChevronDown, ChevronRight,
  RefreshCw, Terminal, Network, Clock, Cookie, Code2,
} from "lucide-react";
import toast from "react-hot-toast";

const fetcher = (url: string) => api.get(url).then((r) => r.data);

const SEV_COLORS: Record<string, string> = {
  critical: "text-red-500 bg-red-500/10 border-red-500/30",
  high:     "text-orange-500 bg-orange-500/10 border-orange-500/30",
  medium:   "text-yellow-500 bg-yellow-500/10 border-yellow-500/30",
  low:      "text-blue-400 bg-blue-400/10 border-blue-400/30",
  info:     "text-muted-foreground bg-muted border-border",
};

const SEV_ICON: Record<string, React.ReactNode> = {
  critical: <ShieldAlert className="h-3.5 w-3.5" />,
  high:     <AlertTriangle className="h-3.5 w-3.5" />,
  medium:   <AlertTriangle className="h-3.5 w-3.5" />,
  low:      <Shield className="h-3.5 w-3.5" />,
  info:     <CheckCircle className="h-3.5 w-3.5" />,
};

function SevBadge({ sev }: { sev: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide", SEV_COLORS[sev] || SEV_COLORS.info)}>
      {SEV_ICON[sev]}{sev}
    </span>
  );
}

function Collapsible({ title, icon, count, badge, children, defaultOpen = true }: {
  title: string; icon: React.ReactNode; count?: number; badge?: React.ReactNode;
  children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-accent/50 transition-colors">
        {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
        <span className="text-muted-foreground">{icon}</span>
        <span className="text-sm font-semibold text-foreground">{title}</span>
        {count !== undefined && <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{count}</span>}
        {badge && <span className="ml-auto">{badge}</span>}
      </button>
      {open && <div className="border-t border-border px-4 py-3">{children}</div>}
    </div>
  );
}

function OverallBanner({ sev }: { sev: string }) {
  const configs: Record<string, { cls: string; icon: React.ReactNode; label: string; sub: string }> = {
    critical: { cls: "bg-red-500/10 border-red-500/30 text-red-500", icon: <ShieldAlert className="h-5 w-5" />, label: "CRITICAL RISK", sub: "Immediate action required" },
    high:     { cls: "bg-orange-500/10 border-orange-500/30 text-orange-500", icon: <AlertTriangle className="h-5 w-5" />, label: "HIGH RISK", sub: "Action recommended soon" },
    medium:   { cls: "bg-yellow-500/10 border-yellow-500/30 text-yellow-500", icon: <AlertTriangle className="h-5 w-5" />, label: "MEDIUM RISK", sub: "Review and remediate" },
    low:      { cls: "bg-blue-400/10 border-blue-400/30 text-blue-400", icon: <Shield className="h-5 w-5" />, label: "LOW RISK", sub: "Minor improvements possible" },
    info:     { cls: "bg-green-500/10 border-green-500/30 text-green-500", icon: <ShieldCheck className="h-5 w-5" />, label: "CLEAN", sub: "No significant vulnerabilities found" },
  };
  const c = configs[sev] || configs.info;
  return (
    <div className={cn("flex items-center gap-3 rounded-lg border p-4", c.cls)}>
      {c.icon}
      <div>
        <p className="text-sm font-bold">{c.label}</p>
        <p className="text-[11px] opacity-70">{c.sub}</p>
      </div>
    </div>
  );
}

// ── Network device audit results ────────────────────────────────────────────

function PortVulns({ vulns }: { vulns: any[] }) {
  if (!vulns.length) return <p className="text-xs text-muted-foreground">No known port vulnerabilities detected.</p>;
  return (
    <div className="space-y-2">
      {vulns.map((v, i) => (
        <div key={i} className={cn("flex items-start gap-3 rounded-md border p-3", SEV_COLORS[v.severity] || SEV_COLORS.info)}>
          <div className="mt-0.5 shrink-0">{SEV_ICON[v.severity]}</div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold">{v.service}</span>
              <span className="text-[10px] font-mono opacity-70">:{v.port}/{v.proto}</span>
              {v.version && <span className="text-[10px] opacity-60">{v.version}</span>}
              <SevBadge sev={v.severity} />
            </div>
            <p className="mt-0.5 text-[11px] opacity-80">{v.risk}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function SslCard({ s }: { s: any }) {
  return (
    <div className="rounded-md border border-border bg-background/50 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Lock className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-mono font-semibold">{s.hostname}:{s.port}</span>
        {s.ok ? <span className="flex items-center gap-1 text-[10px] text-green-500"><CheckCircle className="h-3 w-3" />Connected</span>
               : <span className="flex items-center gap-1 text-[10px] text-red-500"><XCircle className="h-3 w-3" />{s.error}</span>}
      </div>
      {s.ok && (
        <>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[11px]">
            <span className="text-muted-foreground">TLS Version</span><span className={cn("font-mono", s.weak_protocol ? "text-red-500 font-bold" : "")}>{s.tls_version}</span>
            <span className="text-muted-foreground">Cipher</span><span className={cn("font-mono", s.weak_cipher ? "text-red-500 font-bold" : "")}>{s.cipher} ({s.cipher_bits}b)</span>
            <span className="text-muted-foreground">Common Name</span><span className="font-mono">{s.common_name}</span>
            <span className="text-muted-foreground">Issuer</span><span className={cn(s.self_signed ? "text-yellow-500" : "")}>{s.issuer_org}</span>
            <span className="text-muted-foreground">Expires</span><span className={cn((s.expired || s.expiring_soon) ? "text-yellow-500 font-bold" : "")}>{s.not_after ? new Date(s.not_after).toLocaleDateString() : "?"}</span>
            <span className="text-muted-foreground">Days Left</span><span className={cn((s.days_until_expiry ?? 999) < 30 ? "text-yellow-500 font-bold" : "")}>{s.days_until_expiry ?? "?"}</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {s.expired && <SevBadge sev="critical" />}
            {s.expiring_soon && !s.expired && <span className="rounded border border-yellow-500/30 bg-yellow-500/10 px-1.5 py-0.5 text-[10px] font-bold text-yellow-500">EXPIRING SOON</span>}
            {s.weak_protocol && <span className="rounded border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-bold text-red-500">WEAK PROTOCOL</span>}
            {s.weak_cipher && <span className="rounded border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-bold text-red-500">WEAK CIPHER</span>}
            {s.self_signed && <span className="rounded border border-yellow-500/30 bg-yellow-500/10 px-1.5 py-0.5 text-[10px] font-bold text-yellow-500">SELF-SIGNED</span>}
          </div>
        </>
      )}
    </div>
  );
}

function Banners({ banners }: { banners: Record<string, string> }) {
  const entries = Object.entries(banners);
  if (!entries.length) return <p className="text-xs text-muted-foreground">No service banners captured.</p>;
  return (
    <div className="space-y-2">
      {entries.map(([port, banner]) => (
        <div key={port} className="rounded-md border border-border bg-background/50 p-3">
          <p className="mb-1 text-[10px] font-semibold text-muted-foreground uppercase">Port {port}</p>
          <pre className="overflow-x-auto text-[11px] font-mono text-foreground whitespace-pre-wrap break-all">{banner}</pre>
        </div>
      ))}
    </div>
  );
}

// ── Web app audit results ─────────────────────────────────────────────────────

function Findings({ findings }: { findings: any[] }) {
  if (!findings.length) return <p className="text-xs text-muted-foreground">No vulnerabilities detected.</p>;
  return (
    <div className="space-y-2">
      {findings.map((f, i) => (
        <div key={i} className={cn("flex items-start gap-3 rounded-md border p-3", SEV_COLORS[f.severity] || SEV_COLORS.info)}>
          <div className="mt-0.5 shrink-0">{SEV_ICON[f.severity]}</div>
          <div>
            <p className="text-xs font-bold">{f.title}</p>
            <p className="text-[11px] opacity-80">{f.detail}</p>
          </div>
          <SevBadge sev={f.severity} />
        </div>
      ))}
    </div>
  );
}

function TechFingerprint({ techs }: { techs: any[] }) {
  const unique = Array.from(new Map(techs.map(t => [t.tech, t])).values());
  if (!unique.length) return <p className="text-xs text-muted-foreground">No technologies detected.</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {unique.map((t, i) => (
        <div key={i} className="flex items-center gap-1.5 rounded-md border border-border bg-muted px-2.5 py-1.5">
          <Code2 className="h-3 w-3 text-muted-foreground" />
          <span className="text-xs font-semibold">{t.tech}</span>
          {t.version && <span className="text-[10px] text-muted-foreground">{t.version}</span>}
          <span className="text-[9px] text-muted-foreground/60 ml-1">via {t.via}</span>
        </div>
      ))}
    </div>
  );
}

function CookieList({ cookies }: { cookies: any[] }) {
  if (!cookies.length) return <p className="text-xs text-muted-foreground">No cookies set by this page.</p>;
  return (
    <div className="space-y-1">
      {cookies.map((c, i) => (
        <div key={i} className="flex items-center gap-3 rounded-md border border-border bg-background/50 px-3 py-2 text-[11px]">
          <Cookie className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="font-mono font-semibold">{c.name}</span>
          <span className={cn("rounded px-1 py-0.5 text-[10px]", c.secure ? "bg-green-500/10 text-green-500" : "bg-red-500/10 text-red-500")}>Secure{c.secure ? "✓" : "✗"}</span>
          <span className={cn("rounded px-1 py-0.5 text-[10px]", c.httponly ? "bg-green-500/10 text-green-500" : "bg-red-500/10 text-red-500")}>HttpOnly{c.httponly ? "✓" : "✗"}</span>
          <span className={cn("rounded px-1 py-0.5 text-[10px]", c.samesite ? "bg-blue-400/10 text-blue-400" : "bg-muted text-muted-foreground")}>SameSite={c.samesite || "not set"}</span>
        </div>
      ))}
    </div>
  );
}

function SensitivePaths({ paths }: { paths: any[] }) {
  if (!paths.length) return <p className="text-xs text-muted-foreground">No sensitive paths exposed.</p>;
  return (
    <div className="space-y-1">
      {paths.map((p, i) => (
        <div key={i} className={cn("flex items-center gap-3 rounded-md border px-3 py-2 text-[11px]", SEV_COLORS[p.severity])}>
          {p.status === 200 ? <XCircle className="h-3.5 w-3.5 shrink-0" /> : <AlertTriangle className="h-3.5 w-3.5 shrink-0" />}
          <span className="font-mono">{p.path}</span>
          <span className="ml-auto font-mono font-bold">HTTP {p.status}</span>
          <SevBadge sev={p.severity} />
        </div>
      ))}
    </div>
  );
}

function MissingHeaders({ missing }: { missing: any[] }) {
  if (!missing.length) return <p className="text-xs text-green-500 flex items-center gap-1"><CheckCircle className="h-3.5 w-3.5" />All security headers present.</p>;
  return (
    <div className="space-y-1">
      {missing.map((h, i) => (
        <div key={i} className="flex items-start gap-2 text-[11px]">
          <XCircle className="h-3.5 w-3.5 text-red-500 mt-0.5 shrink-0" />
          <div>
            <span className="font-mono text-red-400">{h.header}</span>
            <span className="text-muted-foreground ml-2">— {h.description}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function DnsSec({ dns }: { dns: any }) {
  if (!dns) return null;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div className={cn("rounded-md border p-2.5", dns.spf ? "border-green-500/30 bg-green-500/5" : "border-red-500/30 bg-red-500/5")}>
          <div className="flex items-center gap-1 font-semibold mb-1">
            {dns.spf ? <CheckCircle className="h-3 w-3 text-green-500" /> : <XCircle className="h-3 w-3 text-red-500" />}SPF
          </div>
          <p className="font-mono text-[10px] break-all text-muted-foreground">{dns.spf || "Not found"}</p>
        </div>
        <div className={cn("rounded-md border p-2.5", dns.dmarc ? "border-green-500/30 bg-green-500/5" : "border-red-500/30 bg-red-500/5")}>
          <div className="flex items-center gap-1 font-semibold mb-1">
            {dns.dmarc ? <CheckCircle className="h-3 w-3 text-green-500" /> : <XCircle className="h-3 w-3 text-red-500" />}DMARC
          </div>
          <p className="font-mono text-[10px] break-all text-muted-foreground">{dns.dmarc || "Not found"}</p>
        </div>
      </div>
      {dns.issues?.map((issue: string, i: number) => (
        <div key={i} className="flex items-start gap-1.5 text-[11px] text-yellow-500">
          <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />{issue}
        </div>
      ))}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AuditPage() {
  const [mode, setMode]             = useState<"device" | "target" | "webapp">("webapp");
  const [target, setTarget]         = useState("");
  const [webUrl, setWebUrl]         = useState("");
  const [scanning, setScanning]     = useState(false);
  const [result, setResult]         = useState<any>(null);
  const [selectedDevice, setDevice] = useState("");

  const { data: devices } = useSWR("/devices?limit=200&status=online", fetcher);
  const deviceList: any[] = devices?.items || [];

  const runScan = async () => {
    if (mode === "device" && !selectedDevice) { toast.error("Select a device"); return; }
    if (mode === "target" && !target.trim()) { toast.error("Enter an IP or hostname"); return; }
    if (mode === "webapp" && !webUrl.trim()) { toast.error("Enter a URL"); return; }

    setScanning(true);
    setResult(null);
    try {
      let resp;
      if (mode === "device") {
        resp = await api.post(`/audit/device/${selectedDevice}`);
      } else if (mode === "target") {
        resp = await api.post("/audit/target", { ip: target.trim() });
      } else {
        resp = await api.post("/audit/webapp", { url: webUrl.trim() });
      }
      setResult(resp.data);
      toast.success("Audit complete");
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Audit failed");
    } finally {
      setScanning(false);
    }
  };

  const isWebapp = mode === "webapp";

  return (
    <div className="flex flex-col overflow-hidden h-full">
      <TopBar title="Security Audit" subtitle="SSL · HTTP headers · Port vulns · CORS · Cookies · Sensitive paths · DNS" />

      <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin">
        {/* Mode selector */}
        <div className="rounded-lg border border-border bg-card p-4 space-y-4">
          <div className="flex gap-2 flex-wrap">
            {[
              { id: "webapp", label: "Web App / Website", icon: <Globe className="h-3.5 w-3.5 mr-1.5" /> },
              { id: "device", label: "Network Device",    icon: <Wifi className="h-3.5 w-3.5 mr-1.5" /> },
              { id: "target", label: "Custom IP",         icon: <Network className="h-3.5 w-3.5 mr-1.5" /> },
            ].map(({ id, label, icon }) => (
              <button key={id} onClick={() => { setMode(id as any); setResult(null); }}
                className={cn("inline-flex items-center rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                  mode === id ? "bg-brand-500 text-white" : "bg-muted text-muted-foreground hover:text-foreground")}>
                {icon}{label}
              </button>
            ))}
          </div>

          {/* Input row */}
          {mode === "webapp" && (
            <div className="flex gap-3">
              <div className="relative flex-1">
                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input value={webUrl} onChange={(e) => setWebUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && runScan()}
                  placeholder="https://example.com or example.com"
                  className="w-full rounded-md border border-border bg-background pl-9 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
              </div>
              <button onClick={runScan} disabled={scanning || !webUrl.trim()}
                className="flex items-center gap-2 rounded-md bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50 transition-colors">
                {scanning ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />}
                {scanning ? "Scanning…" : "Audit Website"}
              </button>
            </div>
          )}
          {mode === "device" && (
            <div className="flex gap-3">
              <select value={selectedDevice} onChange={(e) => setDevice(e.target.value)}
                className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring">
                <option value="">— Select an online device —</option>
                {deviceList.map((d: any) => (
                  <option key={d.id} value={d.id}>{d.display_name || d.hostname || d.mac_address} ({d.ip_address})</option>
                ))}
              </select>
              <button onClick={runScan} disabled={scanning || !selectedDevice}
                className="flex items-center gap-2 rounded-md bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50 transition-colors">
                {scanning ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
                {scanning ? "Scanning…" : "Run Audit"}
              </button>
            </div>
          )}
          {mode === "target" && (
            <div className="flex gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input value={target} onChange={(e) => setTarget(e.target.value)} onKeyDown={(e) => e.key === "Enter" && runScan()}
                  placeholder="192.168.1.1 or hostname"
                  className="w-full rounded-md border border-border bg-background pl-9 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
              </div>
              <button onClick={runScan} disabled={scanning || !target.trim()}
                className="flex items-center gap-2 rounded-md bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50 transition-colors">
                {scanning ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                {scanning ? "Scanning…" : "Audit Target"}
              </button>
            </div>
          )}

          {scanning && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              {isWebapp
                ? "Checking SSL, headers, cookies, CORS, sensitive paths, DNS… up to 60s for thorough scan."
                : "Running port analysis, SSL, HTTP, banner grab… up to 30s."}
            </p>
          )}
        </div>

        {/* Results */}
        {result && !scanning && (
          <div className="space-y-4 page-enter">
            <div className="flex items-center gap-3">
              <div>
                <h2 className="text-sm font-bold text-foreground font-mono">{result.url || result.hostname || result.ip}</h2>
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <Clock className="h-3 w-3" />{new Date(result.timestamp).toLocaleString()}
                </div>
              </div>
            </div>

            <OverallBanner sev={result.overall_severity} />

            {/* Web App results */}
            {isWebapp && (
              <>
                <Collapsible title="Vulnerabilities & Findings" icon={<ShieldAlert className="h-3.5 w-3.5" />} count={result.findings?.length} badge={result.findings?.length > 0 && <SevBadge sev={result.overall_severity} />}>
                  <Findings findings={result.findings || []} />
                </Collapsible>

                {result.ssl && (
                  <Collapsible title="SSL / TLS Certificate" icon={<Lock className="h-3.5 w-3.5" />}>
                    <SslCard s={result.ssl} />
                  </Collapsible>
                )}

                <Collapsible title="HTTP Security Headers" icon={<Shield className="h-3.5 w-3.5" />} count={result.missing_security_headers?.length}>
                  <MissingHeaders missing={result.missing_security_headers || []} />
                  {result.security_header_issues?.length > 0 && (
                    <div className="mt-3 space-y-1 border-t border-border pt-3">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Header Quality Issues</p>
                      {result.security_header_issues.map((issue: string, i: number) => (
                        <div key={i} className="flex items-center gap-1.5 text-[11px] text-yellow-500">
                          <AlertTriangle className="h-3 w-3 shrink-0" />{issue}
                        </div>
                      ))}
                    </div>
                  )}
                </Collapsible>

                <Collapsible title="Cookie Security" icon={<Cookie className="h-3.5 w-3.5" />} count={result.cookies?.length} defaultOpen={false}>
                  <CookieList cookies={result.cookies || []} />
                </Collapsible>

                <Collapsible title="Technology Fingerprint" icon={<Code2 className="h-3.5 w-3.5" />} count={result.tech_fingerprint?.length} defaultOpen={false}>
                  <TechFingerprint techs={result.tech_fingerprint || []} />
                </Collapsible>

                {result.cors && (
                  <Collapsible title="CORS Configuration" icon={<Network className="h-3.5 w-3.5" />} badge={result.cors.risky && <SevBadge sev="high" />} defaultOpen={false}>
                    <div className="space-y-1 text-[11px]">
                      <div className="flex gap-3">
                        <span className="text-muted-foreground">Access-Control-Allow-Origin</span>
                        <span className={cn("font-mono font-bold", result.cors.risky ? "text-red-500" : "text-foreground")}>{result.cors.allow_origin}</span>
                      </div>
                      {result.cors.allow_credentials && (
                        <div className="flex gap-3">
                          <span className="text-muted-foreground">Allow-Credentials</span>
                          <span className="font-mono">{result.cors.allow_credentials}</span>
                        </div>
                      )}
                      {result.cors.risky && <p className="text-red-500 flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" />CORS is misconfigured — cross-origin requests allowed from any domain.</p>}
                    </div>
                  </Collapsible>
                )}

                <Collapsible title="Sensitive Path Exposure" icon={<Search className="h-3.5 w-3.5" />} count={result.sensitive_paths?.length} defaultOpen={result.sensitive_paths?.length > 0}>
                  <SensitivePaths paths={result.sensitive_paths || []} />
                </Collapsible>

                {result.dns && (
                  <Collapsible title="DNS Security (SPF · DMARC)" icon={<Globe className="h-3.5 w-3.5" />} defaultOpen={false}>
                    <DnsSec dns={result.dns} />
                  </Collapsible>
                )}
              </>
            )}

            {/* Network device results */}
            {!isWebapp && (
              <>
                <Collapsible title="Port Vulnerabilities" icon={<ShieldAlert className="h-3.5 w-3.5" />} count={result.port_vulns?.length} badge={result.port_vulns?.length > 0 && <SevBadge sev={result.overall_severity} />}>
                  <PortVulns vulns={result.port_vulns || []} />
                </Collapsible>

                {result.ssl?.length > 0 && (
                  <Collapsible title="SSL / TLS Certificates" icon={<Lock className="h-3.5 w-3.5" />} count={result.ssl?.length}>
                    <div className="space-y-3">{result.ssl.map((s: any, i: number) => <SslCard key={i} s={s} />)}</div>
                  </Collapsible>
                )}

                {result.http?.length > 0 && (
                  <Collapsible title="HTTP Security Headers" icon={<Globe className="h-3.5 w-3.5" />} count={result.http?.length}>
                    <div className="space-y-3">
                      {result.http.map((h: any, i: number) => (
                        <div key={i} className="rounded-md border border-border bg-background/50 p-3 space-y-2">
                          <div className="flex items-center gap-2">
                            <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="text-xs font-mono">{h.url}</span>
                            <span className="ml-auto text-[10px] font-mono text-muted-foreground">HTTP {h.status_code}</span>
                          </div>
                          {h.issues?.map((issue: string, j: number) => (
                            <div key={j} className="flex items-start gap-1.5 text-[11px] text-yellow-500">
                              <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />{issue}
                            </div>
                          ))}
                          {h.missing_headers?.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {h.missing_headers.map((hdr: string) => (
                                <span key={hdr} className="rounded bg-red-500/10 border border-red-500/20 px-1.5 py-0.5 text-[10px] font-mono text-red-400">{hdr}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </Collapsible>
                )}

                {Object.keys(result.banners || {}).length > 0 && (
                  <Collapsible title="Service Banners" icon={<Terminal className="h-3.5 w-3.5" />} count={Object.keys(result.banners).length} defaultOpen={false}>
                    <Banners banners={result.banners} />
                  </Collapsible>
                )}

                {result.dns && (
                  <Collapsible title="DNS Security" icon={<Network className="h-3.5 w-3.5" />} defaultOpen={false}>
                    <DnsSec dns={result.dns} />
                  </Collapsible>
                )}
              </>
            )}
          </div>
        )}

        {/* Empty state */}
        {!result && !scanning && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <ShieldCheck className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <p className="text-sm font-semibold text-foreground">
              {mode === "webapp" ? "Enter any website URL to audit" : "Select a target to audit"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground max-w-sm">
              {mode === "webapp"
                ? "Checks: SSL/TLS cert, HTTP security headers, cookie flags, CORS, sensitive files (.env, .git), technology fingerprint, DNS security (SPF/DMARC)."
                : "Checks: open port risk mapping, SSL certificates, HTTP security headers, service banners, DNS security."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
