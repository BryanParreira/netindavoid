"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { TopBar } from "@/components/layout/TopBar";
import {
  ShieldAlert, ShieldCheck, Shield, AlertTriangle, CheckCircle, XCircle,
  RefreshCw, FolderOpen, Package, Code2, Container, FileCode2, Layers,
  ChevronDown, ChevronRight, ExternalLink, Lock, Key, Copy,
} from "lucide-react";
import toast from "react-hot-toast";

// ── Severity helpers ─────────────────────────────────────────────────────────

const SEV_RANK: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4, UNKNOWN: 5 };
const SEV_COLORS: Record<string, string> = {
  CRITICAL: "text-red-500 bg-red-500/10 border-red-500/30",
  HIGH:     "text-orange-500 bg-orange-500/10 border-orange-500/30",
  MEDIUM:   "text-yellow-500 bg-yellow-500/10 border-yellow-500/30",
  LOW:      "text-blue-400 bg-blue-400/10 border-blue-400/30",
  INFO:     "text-muted-foreground bg-muted border-border",
  UNKNOWN:  "text-muted-foreground bg-muted border-border",
};
const SEV_DOT: Record<string, string> = {
  CRITICAL: "bg-red-500", HIGH: "bg-orange-500", MEDIUM: "bg-yellow-500",
  LOW: "bg-blue-400", INFO: "bg-zinc-400", UNKNOWN: "bg-zinc-500",
};

function SevBadge({ sev }: { sev: string }) {
  const s = (sev || "UNKNOWN").toUpperCase();
  return (
    <span className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide", SEV_COLORS[s] || SEV_COLORS.UNKNOWN)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", SEV_DOT[s] || "bg-zinc-500")} />{s}
    </span>
  );
}

function SummaryCard({ label, value, sev }: { label: string; value: number; sev: string }) {
  return (
    <div className={cn("flex flex-col gap-1 rounded-lg border p-4", SEV_COLORS[sev.toUpperCase()] || SEV_COLORS.UNKNOWN)}>
      <span className="text-2xl font-bold font-mono">{value}</span>
      <span className="text-[11px] font-semibold uppercase tracking-wide">{label}</span>
    </div>
  );
}

function Collapsible({ title, icon, count, children, defaultOpen = true, badge }: {
  title: string; icon: React.ReactNode; count?: number;
  children: React.ReactNode; defaultOpen?: boolean; badge?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-accent/50 transition-colors">
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
        <span className="text-muted-foreground shrink-0">{icon}</span>
        <span className="text-sm font-semibold">{title}</span>
        {count !== undefined && <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{count}</span>}
        {badge && <span className="ml-auto">{badge}</span>}
      </button>
      {open && <div className="border-t border-border">{children}</div>}
    </div>
  );
}

// ── Vuln row ─────────────────────────────────────────────────────────────────

function VulnRow({ v, type }: { v: any; type: "dep" | "code" | "iac" | "container" }) {
  const [exp, setExp] = useState(false);
  return (
    <div className="border-b border-border last:border-0">
      <button onClick={() => setExp(!exp)} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-accent/30 transition-colors">
        <SevBadge sev={v.severity} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-foreground">{v.title || v.id}</span>
            {(v.id || v.rule_id) && <span className="text-[10px] font-mono text-muted-foreground">{v.id || v.rule_id}</span>}
            {v.cve_ids?.length > 0 && v.cve_ids.map((cid: string) => (
              <span key={cid} className="rounded bg-blue-500/10 border border-blue-500/20 px-1 py-0.5 text-[9px] font-mono text-blue-400">{cid}</span>
            ))}
            {v.fix_available && <span className="rounded bg-green-500/10 border border-green-500/20 px-1 py-0.5 text-[9px] font-bold text-green-500">FIX AVAILABLE</span>}
          </div>
          <div className="flex items-center gap-3 mt-0.5 text-[11px] text-muted-foreground">
            {type === "dep" && <><Package className="h-3 w-3 shrink-0" />{v.package}@{v.version} ({v.ecosystem})</>}
            {(type === "code" || type === "iac") && <><FileCode2 className="h-3 w-3 shrink-0" />{v.file}{v.line > 0 ? `:${v.line}` : ""}</>}
            {type === "container" && <><Container className="h-3 w-3 shrink-0" />{v.package} {v.version} ({v.layer || v.ecosystem})</>}
            {v.cvss_score != null && <span className="font-mono">CVSS {v.cvss_score.toFixed(1)}</span>}
          </div>
        </div>
        {exp ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground mt-0.5" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground mt-0.5" />}
      </button>
      {exp && (
        <div className="px-4 pb-4 space-y-3 bg-background/30">
          {v.description && <p className="text-[11px] text-muted-foreground leading-relaxed">{v.description}</p>}
          {v.snippet && (
            <pre className="rounded-md bg-card border border-border px-3 py-2 text-[11px] font-mono text-foreground overflow-x-auto whitespace-pre-wrap break-all">{v.snippet}</pre>
          )}
          {v.fix && <div className="rounded-md bg-green-500/5 border border-green-500/20 px-3 py-2 text-[11px] text-green-500"><span className="font-bold">Fix: </span>{v.fix}</div>}
          {v.fix_versions?.length > 0 && (
            <div className="flex items-center gap-2 text-[11px]">
              <CheckCircle className="h-3.5 w-3.5 text-green-500" />
              <span className="text-muted-foreground">Upgrade to:</span>
              {v.fix_versions.map((f: string) => (
                <span key={f} className="rounded bg-green-500/10 border border-green-500/20 px-1.5 py-0.5 font-mono text-green-500">{f}</span>
              ))}
            </div>
          )}
          {v.cwe?.length > 0 && (
            <div className="flex gap-1 text-[10px]">
              {v.cwe.filter(Boolean).map((c: string) => (
                <span key={c} className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">{c.startsWith("CWE") ? c : `CWE-${c}`}</span>
              ))}
            </div>
          )}
          {v.references?.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {v.references.filter(Boolean).map((ref: string, i: number) => (
                <a key={i} href={ref} target="_blank" rel="noopener noreferrer"
                   className="flex items-center gap-1 text-[10px] text-brand-500 hover:underline">
                  <ExternalLink className="h-3 w-3" />Reference {i + 1}
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Tab button ────────────────────────────────────────────────────────────────

const SCAN_TABS = [
  { id: "full",         label: "Full Scan",    icon: <Layers className="h-3.5 w-3.5" />,   desc: "Dependencies + SAST + IaC — everything at once" },
  { id: "dependencies", label: "Dependencies", icon: <Package className="h-3.5 w-3.5" />,  desc: "npm, PyPI, Cargo, Go, Maven, RubyGems — OSV.dev CVE database" },
  { id: "sast",         label: "Code (SAST)",  icon: <Code2 className="h-3.5 w-3.5" />,    desc: "Semgrep + Bandit + secrets detection across all code" },
  { id: "container",    label: "Container",    icon: <Container className="h-3.5 w-3.5" />, desc: "Docker image scan — OS packages + language libs via Trivy" },
  { id: "iac",          label: "IaC",          icon: <FileCode2 className="h-3.5 w-3.5" />, desc: "Dockerfile, docker-compose, Terraform, Kubernetes misconfigs" },
];

// ── FullScan results ──────────────────────────────────────────────────────────

function FullScanResults({ result }: { result: any }) {
  const s = result.summary;
  return (
    <div className="space-y-4">
      <div className={cn("flex items-center gap-3 rounded-lg border p-4",
        result.overall_severity === "critical" ? "bg-red-500/10 border-red-500/30 text-red-500" :
        result.overall_severity === "high" ? "bg-orange-500/10 border-orange-500/30 text-orange-500" :
        result.overall_severity === "medium" ? "bg-yellow-500/10 border-yellow-500/30 text-yellow-500" :
        "bg-green-500/10 border-green-500/30 text-green-500")}>
        {result.overall_severity === "info" || !result.overall_severity
          ? <ShieldCheck className="h-5 w-5" />
          : <ShieldAlert className="h-5 w-5" />}
        <div>
          <p className="text-sm font-bold uppercase">{(result.overall_severity || "clean").toUpperCase()} RISK</p>
          <p className="text-[11px] opacity-70">Full scan of {result.path}</p>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <SummaryCard label="Critical" value={s.critical || 0} sev="CRITICAL" />
        <SummaryCard label="High" value={s.high || 0} sev="HIGH" />
        <SummaryCard label="Medium" value={s.medium || 0} sev="MEDIUM" />
        <SummaryCard label="Low" value={s.low || 0} sev="LOW" />
      </div>

      <div className="grid grid-cols-3 gap-3 text-[11px]">
        {[
          { label: "Dep. Vulnerabilities", value: s.dep_vulns, icon: <Package className="h-3.5 w-3.5" /> },
          { label: "Code Findings", value: s.sast_findings, icon: <Code2 className="h-3.5 w-3.5" /> },
          { label: "IaC Issues", value: s.iac_findings, icon: <FileCode2 className="h-3.5 w-3.5" /> },
          { label: "Secrets Found", value: s.secrets, icon: <Key className="h-3.5 w-3.5" /> },
        ].map(item => (
          <div key={item.label} className="flex items-center gap-2 rounded-md border border-border bg-card p-3">
            <span className="text-muted-foreground">{item.icon}</span>
            <div>
              <p className="text-base font-bold font-mono">{item.value ?? 0}</p>
              <p className="text-[10px] text-muted-foreground">{item.label}</p>
            </div>
          </div>
        ))}
      </div>

      {result.dependencies?.vulnerabilities?.length > 0 && (
        <Collapsible title="Dependency Vulnerabilities" icon={<Package className="h-3.5 w-3.5" />}
          count={result.dependencies.vulnerabilities.length}
          badge={<SevBadge sev={result.dependencies.vulnerabilities[0]?.severity || "LOW"} />}>
          {result.dependencies.vulnerabilities.slice(0, 50).map((v: any, i: number) => <VulnRow key={i} v={v} type="dep" />)}
        </Collapsible>
      )}

      {result.sast?.findings?.length > 0 && (
        <Collapsible title="Code Security Findings" icon={<Code2 className="h-3.5 w-3.5" />}
          count={result.sast.findings.length}
          badge={<SevBadge sev={result.sast.findings[0]?.severity || "LOW"} />}
          defaultOpen={false}>
          {result.sast.findings.slice(0, 50).map((v: any, i: number) => <VulnRow key={i} v={v} type="code" />)}
        </Collapsible>
      )}

      {result.iac?.findings?.length > 0 && (
        <Collapsible title="IaC Misconfigurations" icon={<FileCode2 className="h-3.5 w-3.5" />}
          count={result.iac.findings.length}
          badge={<SevBadge sev={result.iac.findings[0]?.severity || "LOW"} />}
          defaultOpen={false}>
          {result.iac.findings.map((v: any, i: number) => <VulnRow key={i} v={v} type="iac" />)}
        </Collapsible>
      )}
    </div>
  );
}

function DepResults({ result }: { result: any }) {
  const s = result.summary;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-5 gap-3">
        {["CRITICAL","HIGH","MEDIUM","LOW","UNKNOWN"].map(sev => (
          <SummaryCard key={sev} label={sev} value={s[sev] || 0} sev={sev} />
        ))}
      </div>
      <div className="text-xs text-muted-foreground">
        Scanned <strong>{result.packages_scanned}</strong> packages across {result.manifests_found?.length || 0} manifest files.
        {s.fix_available > 0 && <span className="ml-2 text-green-500 font-semibold">✓ {s.fix_available} have fixes available</span>}
      </div>
      {result.manifests_found?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {result.manifests_found.map((m: string) => (
            <span key={m} className="rounded-md border border-border bg-muted px-2 py-0.5 text-[10px] font-mono text-muted-foreground">{m.split("/").slice(-2).join("/")}</span>
          ))}
        </div>
      )}
      <Collapsible title="Vulnerabilities" icon={<ShieldAlert className="h-3.5 w-3.5" />} count={result.vulnerabilities?.length} defaultOpen>
        {result.vulnerabilities?.length > 0
          ? result.vulnerabilities.slice(0, 100).map((v: any, i: number) => <VulnRow key={i} v={v} type="dep" />)
          : <p className="px-4 py-6 text-center text-xs text-green-500 flex items-center justify-center gap-1"><ShieldCheck className="h-4 w-4" />No known vulnerabilities found.</p>
        }
      </Collapsible>
    </div>
  );
}

function SastResults({ result }: { result: any }) {
  const s = result.summary;
  const secrets = result.findings?.filter((f: any) => f.category === "secrets") || [];
  const code = result.findings?.filter((f: any) => f.category !== "secrets") || [];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-3">
        <SummaryCard label="Critical" value={s.CRITICAL || 0} sev="CRITICAL" />
        <SummaryCard label="High" value={s.HIGH || 0} sev="HIGH" />
        <SummaryCard label="Medium" value={s.MEDIUM || 0} sev="MEDIUM" />
        <SummaryCard label="Low" value={s.LOW || 0} sev="LOW" />
      </div>
      {secrets.length > 0 && (
        <Collapsible title="Secrets & Hardcoded Credentials" icon={<Key className="h-3.5 w-3.5" />} count={secrets.length}
          badge={<SevBadge sev="CRITICAL" />}>
          {secrets.map((v: any, i: number) => <VulnRow key={i} v={v} type="code" />)}
        </Collapsible>
      )}
      <Collapsible title="Code Security Issues" icon={<Code2 className="h-3.5 w-3.5" />} count={code.length} defaultOpen={secrets.length === 0}>
        {code.length > 0
          ? code.slice(0, 100).map((v: any, i: number) => <VulnRow key={i} v={v} type="code" />)
          : <p className="px-4 py-6 text-center text-xs text-green-500 flex items-center justify-center gap-1"><ShieldCheck className="h-4 w-4" />No code security issues found.</p>
        }
      </Collapsible>
    </div>
  );
}

function ContainerResults({ result }: { result: any }) {
  const s = result.summary;
  if (result.error) {
    return <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500">{result.error}</div>;
  }
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card p-3 text-[11px] space-y-1">
        <div className="flex gap-3"><span className="text-muted-foreground">Image</span><span className="font-mono">{result.image?.image_id || result.target}</span></div>
        {result.image?.os && <div className="flex gap-3"><span className="text-muted-foreground">OS</span><span className="font-mono">{result.image.os.trim()}</span></div>}
      </div>
      <div className="grid grid-cols-5 gap-3">
        {["CRITICAL","HIGH","MEDIUM","LOW","UNKNOWN"].map(sev => (
          <SummaryCard key={sev} label={sev} value={s[sev] || 0} sev={sev} />
        ))}
      </div>
      {s.fix_available > 0 && <p className="text-xs text-green-500 font-semibold">✓ {s.fix_available} vulnerabilities have fixes available</p>}
      <Collapsible title="Vulnerabilities" icon={<ShieldAlert className="h-3.5 w-3.5" />} count={result.vulnerabilities?.length} defaultOpen>
        {result.vulnerabilities?.length > 0
          ? result.vulnerabilities.slice(0, 100).map((v: any, i: number) => <VulnRow key={i} v={v} type="container" />)
          : <p className="px-4 py-6 text-center text-xs text-green-500 flex items-center justify-center gap-1"><ShieldCheck className="h-4 w-4" />No vulnerabilities found.</p>
        }
      </Collapsible>
      {result.secrets?.length > 0 && (
        <Collapsible title="Secrets in Image" icon={<Key className="h-3.5 w-3.5" />} count={result.secrets.length} badge={<SevBadge sev="CRITICAL" />} defaultOpen>
          {result.secrets.map((v: any, i: number) => <VulnRow key={i} v={v} type="code" />)}
        </Collapsible>
      )}
      {result.misconfigurations?.length > 0 && (
        <Collapsible title="Misconfigurations" icon={<FileCode2 className="h-3.5 w-3.5" />} count={result.misconfigurations.length} defaultOpen={false}>
          {result.misconfigurations.map((v: any, i: number) => <VulnRow key={i} v={v} type="iac" />)}
        </Collapsible>
      )}
    </div>
  );
}

function IacResults({ result }: { result: any }) {
  const s = result.summary;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-3">
        <SummaryCard label="Critical" value={s.CRITICAL || 0} sev="CRITICAL" />
        <SummaryCard label="High" value={s.HIGH || 0} sev="HIGH" />
        <SummaryCard label="Medium" value={s.MEDIUM || 0} sev="MEDIUM" />
        <SummaryCard label="Low" value={s.LOW || 0} sev="LOW" />
      </div>
      <Collapsible title="IaC Findings" icon={<FileCode2 className="h-3.5 w-3.5" />} count={result.findings?.length} defaultOpen>
        {result.findings?.length > 0
          ? result.findings.map((v: any, i: number) => <VulnRow key={i} v={v} type="iac" />)
          : <p className="px-4 py-6 text-center text-xs text-green-500 flex items-center justify-center gap-1"><ShieldCheck className="h-4 w-4" />No IaC misconfigurations found.</p>
        }
      </Collapsible>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function VulnScanPage() {
  const [activeTab, setActiveTab] = useState("full");
  const [path, setPath]           = useState("");
  const [image, setImage]         = useState("");
  const [scanning, setScanning]   = useState(false);
  const [result, setResult]       = useState<any>(null);

  const currentTab = SCAN_TABS.find(t => t.id === activeTab)!;

  const runScan = async () => {
    const isContainer = activeTab === "container";
    if (isContainer && !image.trim()) { toast.error("Enter a Docker image name"); return; }
    if (!isContainer && !path.trim()) { toast.error("Enter a directory path"); return; }

    setScanning(true);
    setResult(null);
    try {
      const endpoint = `/vulnscan/${activeTab}`;
      const body = isContainer ? { image: image.trim() } : { path: path.trim() };
      const resp = await api.post(endpoint, body);
      setResult(resp.data);
      toast.success("Scan complete");
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      toast.error(Array.isArray(detail) ? detail[0]?.msg : (detail || "Scan failed"));
    } finally {
      setScanning(false);
    }
  };

  const isContainer = activeTab === "container";

  return (
    <div className="flex flex-col overflow-hidden h-full">
      <TopBar title="Vulnerability Scanner" subtitle="Dependencies · SAST · Secrets · Container · IaC — powered by OSV.dev · Semgrep · Trivy" />

      <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin">

        {/* Scan type tabs */}
        <div className="flex gap-2 flex-wrap">
          {SCAN_TABS.map(tab => (
            <button key={tab.id} onClick={() => { setActiveTab(tab.id); setResult(null); }}
              className={cn("inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-semibold transition-colors",
                activeTab === tab.id
                  ? "bg-brand-500 border-brand-500 text-white"
                  : "border-border bg-card text-muted-foreground hover:text-foreground hover:bg-accent")}>
              {tab.icon}{tab.label}
            </button>
          ))}
        </div>

        <p className="text-xs text-muted-foreground -mt-3">{currentTab.desc}</p>

        {/* Input */}
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          {isContainer ? (
            <div className="flex gap-3">
              <div className="relative flex-1">
                <Container className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input value={image} onChange={(e) => setImage(e.target.value)} onKeyDown={(e) => e.key === "Enter" && runScan()}
                  placeholder="nginx:latest  or  python:3.11-alpine  or  sha256:..."
                  className="w-full rounded-md border border-border bg-background pl-9 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
              </div>
              <button onClick={runScan} disabled={scanning || !image.trim()}
                className="flex items-center gap-2 rounded-md bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50 transition-colors">
                {scanning ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Container className="h-4 w-4" />}
                {scanning ? "Scanning…" : "Scan Image"}
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex gap-3">
                <div className="relative flex-1">
                  <FolderOpen className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input value={path} onChange={(e) => setPath(e.target.value)} onKeyDown={(e) => e.key === "Enter" && runScan()}
                    placeholder="/Users/you/your-project  or  ~/projects/client-app"
                    className="w-full rounded-md border border-border bg-background pl-9 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
                </div>
                <button onClick={runScan} disabled={scanning || !path.trim()}
                  className="flex items-center gap-2 rounded-md bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50 transition-colors">
                  {scanning ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
                  {scanning ? "Scanning…" : "Scan Project"}
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Enter an absolute path to a project directory. Supports your own projects, client code, open-source repos.
                <button onClick={() => setPath("/Users/bryanbernardo/Desktop/netindavoid")}
                  className="ml-2 text-brand-500 hover:underline">Use this app</button>
              </p>
            </div>
          )}

          {scanning && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              {activeTab === "full" && "Running dependency scan (OSV.dev), SAST (semgrep + bandit), IaC analysis…"}
              {activeTab === "dependencies" && "Querying OSV.dev CVE database for all detected packages…"}
              {activeTab === "sast" && "Running semgrep auto rules + bandit + secrets detection across all files…"}
              {activeTab === "container" && "Pulling and scanning image with trivy (OS + language packages + secrets)…"}
              {activeTab === "iac" && "Analyzing Dockerfile, docker-compose, Terraform, K8s manifests…"}
            </div>
          )}
        </div>

        {/* Results */}
        {result && !scanning && (
          <div className="page-enter">
            {activeTab === "full"         && <FullScanResults result={result} />}
            {activeTab === "dependencies" && <DepResults result={result} />}
            {activeTab === "sast"         && <SastResults result={result} />}
            {activeTab === "container"    && <ContainerResults result={result} />}
            {activeTab === "iac"          && <IacResults result={result} />}
          </div>
        )}

        {/* Empty state */}
        {!result && !scanning && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <ShieldCheck className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <p className="text-sm font-semibold">
              {activeTab === "full"         && "Enter a project path to scan everything"}
              {activeTab === "dependencies" && "Detects: npm, PyPI, Cargo, Go, Maven, RubyGems, NuGet, Packagist"}
              {activeTab === "sast"         && "Semgrep (50+ languages) + Bandit (Python) + secrets across all files"}
              {activeTab === "container"    && "Scan any local or remote Docker image for OS + application CVEs"}
              {activeTab === "iac"          && "Dockerfile · docker-compose · Terraform · Kubernetes · Helm"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground max-w-md">
              Powered by OSV.dev (Google's open vulnerability database), Semgrep, Trivy, and Bandit. No API keys required.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
