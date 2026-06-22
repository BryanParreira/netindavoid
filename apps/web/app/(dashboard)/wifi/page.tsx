"use client";
import { useState, useRef } from "react";
import { api } from "@/lib/api";
import { TopBar } from "@/components/layout/TopBar";
import { cn } from "@/lib/utils";
import toast from "react-hot-toast";
import {
  Wifi, WifiOff, Radio, Shield, ShieldAlert, ShieldX,
  Eye, AlertTriangle, Scan, Zap, RefreshCw,
  Signal, Lock, Unlock, Users, ChevronDown, ChevronRight,
  Antenna, Radar,
} from "lucide-react";

// ── Signal bar component ──────────────────────────────────────────────────────

function SignalBars({ rssi }: { rssi: number }) {
  const bars = rssi >= -50 ? 4 : rssi >= -60 ? 3 : rssi >= -70 ? 2 : rssi >= -80 ? 1 : 0;
  const color = bars >= 3 ? "bg-emerald-500" : bars === 2 ? "bg-yellow-500" : "bg-red-500";
  return (
    <span className="flex items-end gap-[2px] h-4" title={`${rssi} dBm`}>
      {[1, 2, 3, 4].map((b) => (
        <span key={b} className={cn("w-1 rounded-sm transition-colors",
          b <= bars ? color : "bg-muted",
          b === 1 ? "h-1" : b === 2 ? "h-2" : b === 3 ? "h-3" : "h-4"
        )} />
      ))}
    </span>
  );
}

// ── Security badge ────────────────────────────────────────────────────────────

function SecBadge({ sec }: { sec: string }) {
  const isOpen = sec === "Open";
  const isWPA3 = sec.includes("WPA3");
  const isWPA2 = sec.includes("WPA2");
  return (
    <span className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold",
      isOpen  ? "border-red-500/30 bg-red-500/10 text-red-400" :
      isWPA3  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" :
      isWPA2  ? "border-blue-500/30 bg-blue-500/10 text-blue-400" :
                "border-yellow-500/30 bg-yellow-500/10 text-yellow-400")}>
      {isOpen ? <Unlock className="h-2.5 w-2.5" /> : <Lock className="h-2.5 w-2.5" />}
      {sec}
    </span>
  );
}

// ── AP row ────────────────────────────────────────────────────────────────────

function APRow({ ap, isRogue }: { ap: any; isRogue: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cn("border-b border-border last:border-0", isRogue && "bg-red-500/5")}>
      <button onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-accent/30 transition-colors">
        <SignalBars rssi={ap.rssi ?? -99} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn("text-sm font-semibold", ap.ssid === "(hidden)" ? "text-muted-foreground italic" : "text-foreground")}>
              {ap.ssid || "(hidden)"}
            </span>
            {isRogue && (
              <span className="rounded border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-bold text-red-400 uppercase">
                ⚠ Rogue AP
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5 text-[10px] text-muted-foreground font-mono">
            {ap.bssid && <span>{ap.bssid}</span>}
            {ap.channel && <span>ch {ap.channel}</span>}
            {ap.band && <span>{ap.band}</span>}
            {ap.rssi && <span>{ap.rssi} dBm</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {ap.security && <SecBadge sec={ap.security} />}
          {ap.clients > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Users className="h-3 w-3" />{ap.clients}
            </span>
          )}
          {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
        </div>
      </button>
      {open && (
        <div className="px-4 pb-3 space-y-2 bg-background/30 text-xs">
          {ap.phy     && <div className="flex gap-2"><span className="text-muted-foreground w-24">PHY Mode</span><span className="font-mono text-foreground">{ap.phy}</span></div>}
          {ap.bssid   && <div className="flex gap-2"><span className="text-muted-foreground w-24">BSSID</span><span className="font-mono text-foreground">{ap.bssid}</span></div>}
          {ap.channel && <div className="flex gap-2"><span className="text-muted-foreground w-24">Channel</span><span className="font-mono text-foreground">{ap.channel} ({ap.band})</span></div>}
          {ap.noise   && <div className="flex gap-2"><span className="text-muted-foreground w-24">SNR</span><span className="font-mono text-foreground">{(ap.rssi ?? 0) - (ap.noise ?? 0)} dB (signal {ap.rssi} / noise {ap.noise})</span></div>}
          {isRogue && ap.rogue_reason && (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-400">
              {ap.rogue_reason}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Probe row ─────────────────────────────────────────────────────────────────

function ProbeRow({ p }: { p: any }) {
  const isWildcard = p.ssid?.startsWith("(wildcard");
  return (
    <div className="flex items-center gap-3 border-b border-border last:border-0 px-4 py-2.5 hover:bg-accent/20">
      <Eye className="h-3.5 w-3.5 shrink-0 text-violet-400" />
      <div className="flex-1 min-w-0">
        <span className={cn("text-xs font-medium", isWildcard ? "text-muted-foreground italic" : "text-foreground")}>
          {p.ssid}
        </span>
      </div>
      <span className="font-mono text-[10px] text-muted-foreground shrink-0">{p.mac}</span>
      {p.rssi && <span className="text-[10px] text-muted-foreground shrink-0">{p.rssi} dBm</span>}
    </div>
  );
}

// ── Deauth row ────────────────────────────────────────────────────────────────

const DEAUTH_REASONS: Record<number, string> = {
  1: "Unspecified", 2: "Auth no longer valid", 3: "Leaving BSS",
  4: "Inactivity", 5: "AP too busy", 6: "Class 2 frame from non-auth",
  7: "Class 3 frame from non-assoc", 8: "Leaving BSS (re-assoc)",
  9: "Non-auth station", 15: "MIC failure (TKIP)",
};

function DeauthRow({ d }: { d: any }) {
  const isBcast = d.dst === "ff:ff:ff:ff:ff:ff";
  return (
    <div className="flex items-start gap-3 border-b border-border last:border-0 px-4 py-2.5 hover:bg-red-500/5">
      <ShieldX className="h-3.5 w-3.5 shrink-0 text-red-400 mt-0.5" />
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-red-400 uppercase">{d.type}</span>
          {isBcast && <span className="rounded bg-red-500/15 border border-red-500/20 px-1 py-0.5 text-[9px] font-bold text-red-400">BROADCAST — LIKELY ATTACK</span>}
        </div>
        <div className="text-[10px] font-mono text-muted-foreground">
          {d.src} → {d.dst}
        </div>
        {d.reason > 0 && (
          <div className="text-[10px] text-muted-foreground">
            Reason {d.reason}: {DEAUTH_REASONS[d.reason] || "Unknown"}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({ title, icon, count, children, badge }: {
  title: string; icon: React.ReactNode; count?: number;
  children: React.ReactNode; badge?: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <button onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-accent/40 transition-colors">
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
        <span className="text-muted-foreground shrink-0">{icon}</span>
        <span className="text-xs font-semibold uppercase tracking-wider">{title}</span>
        {count !== undefined && <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{count}</span>}
        {badge && <span className="ml-auto">{badge}</span>}
      </button>
      {open && <div className="border-t border-border">{children}</div>}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const TABS = [
  { id: "full",  label: "Full Scan",    icon: <Radar className="h-3.5 w-3.5" />,      desc: "Monitor mode: APs + probes + deauth detection (~12s, WiFi disconnects briefly)" },
  { id: "quick", label: "Quick Scan",   icon: <Scan  className="h-3.5 w-3.5" />,      desc: "Passive: channel/security/signal only — no monitor mode, stays connected" },
];

export default function WifiIntelPage() {
  const [tab, setTab]         = useState("full");
  const [duration, setDur]    = useState(12);
  const [scanning, setScanning] = useState(false);
  const [result, setResult]   = useState<any>(null);
  const knownAps = useRef<Record<string, string>>({});

  const scan = async () => {
    setScanning(true);
    setResult(null);
    try {
      const endpoint = tab === "full" ? "/wifi/scan" : "/wifi/aps/quick";
      const body = tab === "full" ? { duration, known_aps: knownAps.current } : undefined;
      const resp = tab === "full"
        ? await api.post(endpoint, body)
        : await api.get(endpoint);

      const data = resp.data;
      setResult(data);

      // Save known APs for rogue detection on next scan
      if (data.aps) {
        for (const ap of data.aps) {
          if (ap.ssid && ap.ssid !== "(hidden)" && ap.bssid) {
            knownAps.current[ap.ssid] = ap.bssid;
          }
        }
      }

      const stats = data.stats;
      if (stats) {
        toast.success(`Found ${stats.aps_found} APs · ${stats.probes_seen} probes · ${stats.deauth_events} deauths`);
      } else {
        toast.success("Scan complete");
      }
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      toast.error(Array.isArray(detail) ? detail[0]?.msg : (detail || "Scan failed"));
    } finally {
      setScanning(false);
    }
  };

  const rogueSet = new Set((result?.rogues ?? []).map((r: any) => r.bssid));
  const deauthAttacks = (result?.deauths ?? []).filter((d: any) => d.dst === "ff:ff:ff:ff:ff:ff");

  return (
    <div className="flex flex-col overflow-hidden h-full">
      <TopBar title="WiFi Intelligence" subtitle="AP scanner · Probe monitor · Deauth detection · Rogue AP" live={scanning} />

      <div className="flex-1 overflow-y-auto p-5 scrollbar-thin space-y-5">

        {/* Scan type tabs */}
        <div className="flex gap-2">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => { setTab(t.id); setResult(null); }}
              className={cn("inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-semibold transition-colors",
                tab === t.id
                  ? "bg-brand-500 border-brand-500 text-white"
                  : "border-border bg-card text-muted-foreground hover:text-foreground hover:bg-accent")}>
              {t.icon}{t.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground -mt-3">
          {TABS.find(t => t.id === tab)?.desc}
        </p>

        {/* Controls */}
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          {tab === "full" && (
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Duration:</span>
                {[5, 12, 20, 30].map((s) => (
                  <button key={s} onClick={() => setDur(s)}
                    className={cn("rounded-md px-2 py-1 text-xs font-medium transition-colors",
                      duration === s ? "bg-brand-500 text-white" : "bg-muted hover:bg-accent")}>
                    {s}s
                  </button>
                ))}
              </div>
              <div className="ml-auto text-[10px] text-muted-foreground">
                ⚠ WiFi disconnects for {duration}s during monitor mode scan
              </div>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button onClick={scan} disabled={scanning}
              className="flex items-center gap-2 rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50 transition-colors">
              {scanning ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Radar className="h-4 w-4" />}
              {scanning
                ? tab === "full" ? `Scanning... (${duration}s)` : "Scanning..."
                : tab === "full" ? "Start Monitor Scan" : "Quick Scan"}
            </button>
            {result?.stats && (
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span><strong className="text-foreground">{result.stats.aps_found}</strong> APs</span>
                <span><strong className="text-foreground">{result.stats.probes_seen}</strong> probes</span>
                <span><strong className={result.stats.deauth_events > 0 ? "text-red-400" : "text-foreground"}>{result.stats.deauth_events}</strong> deauths</span>
                {result.stats.rogues_found > 0 && (
                  <span><strong className="text-red-400">{result.stats.rogues_found}</strong> rogue APs</span>
                )}
              </div>
            )}
          </div>

          {scanning && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              {tab === "full"
                ? `Capturing 802.11 management frames in monitor mode (${duration}s)… WiFi temporarily disconnected`
                : "Reading nearby APs from system_profiler…"}
            </div>
          )}

          {result?.warning && (
            <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-400">
              <strong>Monitor mode unavailable.</strong> {result.warning}
              <br />
              <code className="mt-1 block font-mono text-[10px] text-yellow-300">
                bash scripts/setup-wifi-intel.sh
              </code>
            </div>
          )}
        </div>

        {/* Current connection */}
        {result?.current_connection && !result.current_connection.error && (
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 mb-3">
              <Wifi className="h-4 w-4 text-brand-400" />
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Your Connection</span>
              <span className="ml-auto text-[10px] text-muted-foreground">Interface: {result.current_connection.interface}</span>
            </div>
            <div className="grid grid-cols-3 gap-4 text-xs">
              {[
                { label: "SSID",    value: result.current_connection.ssid },
                { label: "BSSID",   value: result.current_connection.bssid },
                { label: "Channel", value: `${result.current_connection.channel} (${result.current_connection.band})` },
                { label: "Signal",  value: `${result.current_connection.rssi} dBm` },
                { label: "Noise",   value: `${result.current_connection.noise} dBm` },
                { label: "SNR",     value: `${result.current_connection.snr} dB` },
              ].map(({ label, value }) => (
                <div key={label}>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">{label}</p>
                  <p className="font-mono text-foreground">{value}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Alert: broadcast deauths detected */}
        {deauthAttacks.length > 0 && (
          <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 flex items-start gap-3">
            <ShieldAlert className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-red-400">Deauth Attack Detected</p>
              <p className="text-xs text-red-300 mt-0.5">
                {deauthAttacks.length} broadcast deauthentication frame{deauthAttacks.length > 1 ? "s" : ""} detected.
                This may indicate a deauth/disassoc attack on your network.
              </p>
            </div>
          </div>
        )}

        {/* Rogue APs alert */}
        {result?.rogues?.length > 0 && (
          <div className="rounded-xl border border-orange-500/40 bg-orange-500/10 p-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-orange-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-orange-400">Rogue AP{result.rogues.length > 1 ? "s" : ""} Detected</p>
              <p className="text-xs text-orange-300 mt-0.5">
                {result.rogues.length} AP{result.rogues.length > 1 ? "s" : ""} broadcasting known SSIDs from unexpected BSSIDs.
                Possible evil-twin / honeypot attack.
              </p>
            </div>
          </div>
        )}

        {/* Results */}
        {result && !scanning && (
          <div className="space-y-4 page-enter">

            {/* APs */}
            {result.aps?.length > 0 && (
              <Section title="Nearby Access Points" icon={<Antenna className="h-3.5 w-3.5" />} count={result.aps.length}
                badge={result.mode === "monitor" ?
                  <span className="rounded border border-brand-500/30 bg-brand-500/10 px-1.5 py-0.5 text-[10px] text-brand-400">Monitor Mode</span> :
                  <span className="rounded border border-muted bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">Passive</span>
                }>
                {result.aps.map((ap: any) => (
                  <APRow key={ap.bssid || ap.channel} ap={ap} isRogue={rogueSet.has(ap.bssid)} />
                ))}
              </Section>
            )}

            {/* Probe Requests */}
            {result.probes?.length > 0 && (
              <Section title="Probe Requests" icon={<Eye className="h-3.5 w-3.5" />} count={result.probes.length}>
                <div className="px-4 py-2 text-[10px] text-muted-foreground border-b border-border">
                  Devices looking for networks — reveals device history even when offline
                </div>
                {result.probes.map((p: any, i: number) => <ProbeRow key={i} p={p} />)}
              </Section>
            )}

            {/* Deauth Events */}
            {result.deauths?.length > 0 && (
              <Section title="Deauth / Disassoc Events" icon={<ShieldX className="h-3.5 w-3.5 text-red-400" />} count={result.deauths.length}
                badge={deauthAttacks.length > 0 ? <span className="text-[10px] text-red-400 font-bold">{deauthAttacks.length} BROADCAST</span> : undefined}>
                {result.deauths.map((d: any, i: number) => <DeauthRow key={i} d={d} />)}
              </Section>
            )}

            {/* Client associations */}
            {result.clients?.length > 0 && (
              <Section title="Client Associations" icon={<Users className="h-3.5 w-3.5" />} count={result.clients.length}>
                <div className="divide-y divide-border">
                  {result.clients.map((c: any, i: number) => (
                    <div key={i} className="px-4 py-2.5 text-xs">
                      <div className="font-mono text-brand-400 mb-1">{c.bssid}</div>
                      <div className="flex flex-wrap gap-2">
                        {c.macs.map((m: string) => (
                          <span key={m} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{m}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* Empty */}
            {!result.aps?.length && !result.probes?.length && !result.deauths?.length && (
              <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
                <WifiOff className="h-10 w-10 mb-3 opacity-30" />
                <p className="text-sm">No data captured.</p>
                <p className="text-xs mt-1">Monitor mode may need setup — run <code className="font-mono text-brand-400">scripts/setup-wifi-intel.sh</code></p>
              </div>
            )}

          </div>
        )}

        {/* Empty state */}
        {!result && !scanning && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Radar className="h-12 w-12 text-muted-foreground/25 mb-4" />
            <p className="text-sm font-semibold">WiFi Intelligence Scanner</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm">
              Monitor mode captures raw 802.11 management frames: AP beacons (SSID/BSSID/security/PHY),
              probe requests from nearby devices, deauth/disassoc attacks, client associations.
            </p>
            <div className="mt-4 text-[10px] text-muted-foreground/60 space-y-1">
              <p>Inspired by ESP32Marauder · Powered by tcpdump + scapy</p>
              <p>First run: <code className="font-mono text-brand-400">bash scripts/setup-wifi-intel.sh</code></p>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
