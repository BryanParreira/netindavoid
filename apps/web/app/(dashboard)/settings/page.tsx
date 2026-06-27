"use client";
import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { TopBar } from "@/components/layout/TopBar";
import toast from "react-hot-toast";
import { Server, Network, Cpu, RefreshCw, Loader2, Globe } from "lucide-react";

const Field = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
  <div className="space-y-1.5">
    <label className="block text-[11px] font-semibold text-white">{label}</label>
    {hint && <p className="text-[10px]" style={{ color: "hsl(240 4% 40%)" }}>{hint}</p>}
    {children}
  </div>
);

const Input = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input
    {...props}
    className="w-full rounded-sm border px-3 py-2 text-[12px] font-mono outline-none transition-colors focus:border-[#8b5cf6]"
    style={{ background: "hsl(240 7% 7%)", borderColor: "hsl(240 4% 18%)", color: "hsl(240 5% 84%)" }}
  />
);

function Section({ icon: Icon, title, children }: { icon: any; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-sm border p-5 space-y-4"
             style={{ borderColor: "hsl(240 4% 16%)", background: "hsl(240 5% 11%)" }}>
      <h2 className="flex items-center gap-2 text-[12px] font-semibold text-white">
        <Icon className="h-3.5 w-3.5" style={{ color: "#8b5cf6" }} />
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function SettingsPage() {
  const [scanCidr, setScanCidr]     = useState("192.168.1.0/24");
  const [apiUrl, setApiUrl]         = useState("http://localhost:8000");
  const [version, setVersion]       = useState<any>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [networks, setNetworks]     = useState<any[]>([]);
  const [editingId, setEditingId]   = useState<string | null>(null);
  const [editName, setEditName]     = useState("");

  useEffect(() => {
    setApiUrl(process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000");
    fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/version`)
      .then(r => r.json()).then(setVersion).catch(() => {});
    api.get("/network/history").then(r => setNetworks(r.data)).catch(() => {});
  }, []);

  const saveNetwork = async () => {
    try {
      // Store CIDR in localStorage for now (no backend config endpoint needed)
      localStorage.setItem("scan_cidr", scanCidr);
      toast.success("Network config saved");
    } catch { toast.error("Save failed"); }
  };

  const renameNetwork = async (id: string) => {
    try {
      await api.patch(`/network/history/${id}`, { display_name: editName });
      setNetworks(nets => nets.map(n => n.id === id ? { ...n, display_name: editName } : n));
      setEditingId(null);
      toast.success("Network renamed");
    } catch { toast.error("Failed to rename"); }
  };

  const checkUpdate = async () => {
    setCheckingUpdate(true);
    try {
      const r = await fetch(`${apiUrl}/version`);
      const v = await r.json();
      setVersion(v);
      toast.success(`On commit ${v.commit} (${v.branch})`);
    } catch { toast.error("Could not reach API"); }
    finally { setCheckingUpdate(false); }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar title="Settings" />
      <div className="flex-1 overflow-y-auto scrollbar-thin p-6">
        <div className="max-w-xl space-y-5">

          <Section icon={Network} title="Network Scan">
            <Field label="Subnet CIDR" hint="Range scanned when discovering devices">
              <Input value={scanCidr} onChange={e => setScanCidr(e.target.value)} placeholder="192.168.1.0/24" />
            </Field>
            <button onClick={saveNetwork}
              className="rounded-sm px-4 py-2 text-[12px] font-semibold text-white transition-colors hover:opacity-90"
              style={{ background: "#7c3aed" }}>
              Save
            </button>
          </Section>

          <Section icon={Globe} title="Network History">
            <p className="text-[11px]" style={{ color: "hsl(240 4% 40%)" }}>
              Each physical network (identified by its router&apos;s MAC address) is stored separately.
              Data from different networks never mixes.
            </p>
            <div className="space-y-2 mt-2">
              {networks.length === 0 && (
                <p className="text-[11px]" style={{ color: "hsl(240 4% 30%)" }}>
                  No networks detected yet. The app will register your current network automatically.
                </p>
              )}
              {networks.map((net) => (
                <div
                  key={net.id}
                  className="flex items-center gap-3 rounded-sm border px-3 py-2"
                  style={{
                    borderColor: net.is_active ? "#7c3aed" : "hsl(240 4% 18%)",
                    background: "hsl(240 7% 7%)",
                  }}
                >
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ background: net.is_active ? "#22d3ee" : "hsl(240 4% 30%)" }}
                  />
                  <div className="flex-1 min-w-0">
                    {editingId === net.id ? (
                      <div className="flex gap-2">
                        <Input
                          value={editName}
                          onChange={e => setEditName(e.target.value)}
                          onKeyDown={e => e.key === "Enter" && renameNetwork(net.id)}
                          autoFocus
                        />
                        <button
                          onClick={() => renameNetwork(net.id)}
                          className="text-[11px] px-2 rounded-sm"
                          style={{ background: "#7c3aed", color: "#fff" }}
                        >Save</button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="text-[11px] px-2 rounded-sm"
                          style={{ color: "hsl(240 4% 40%)" }}
                        >✕</button>
                      </div>
                    ) : (
                      <>
                        <p className="text-[12px] font-medium truncate" style={{ color: "#ededed" }}>
                          {net.display_name || net.ssid || net.subnet_cidr || net.gateway_mac}
                        </p>
                        <p className="text-[10px] font-mono" style={{ color: "hsl(240 4% 40%)" }}>
                          {net.gateway_mac} · {net.subnet_cidr}
                          {net.is_active && (
                            <span className="ml-2" style={{ color: "#22d3ee" }}>● active</span>
                          )}
                        </p>
                      </>
                    )}
                  </div>
                  {editingId !== net.id && (
                    <button
                      onClick={() => { setEditingId(net.id); setEditName(net.display_name || ""); }}
                      className="text-[10px] shrink-0"
                      style={{ color: "hsl(240 4% 40%)" }}
                    >rename</button>
                  )}
                </div>
              ))}
            </div>
          </Section>

          <Section icon={Cpu} title="AI Provider">
            <p className="text-[11px]" style={{ color: "hsl(240 4% 44%)" }}>
              Configure AI model in the{" "}
              <a href="/ai" className="underline" style={{ color: "#a78bfa" }}>AI Assistant</a>{" "}
              page — click the provider button in the top-right corner.
            </p>
          </Section>

          <Section icon={Server} title="About">
            <div className="space-y-1 text-[11px] font-mono" style={{ color: "hsl(240 4% 44%)" }}>
              <p>Vex Security Monitor</p>
              {version && (
                <>
                  <p>Commit: <span style={{ color: "#a78bfa" }}>{version.commit}</span></p>
                  <p>Branch: <span style={{ color: "#a78bfa" }}>{version.branch}</span></p>
                </>
              )}
              <p>API: <a href={`${apiUrl}/docs`} target="_blank" className="underline" style={{ color: "#a78bfa" }}>{apiUrl}/docs</a></p>
            </div>
            <button onClick={checkUpdate} disabled={checkingUpdate}
              className="flex items-center gap-2 rounded-sm border px-4 py-2 text-[11px] transition-colors hover:bg-white/5 disabled:opacity-50"
              style={{ borderColor: "hsl(240 4% 18%)", color: "hsl(240 4% 52%)" }}>
              <RefreshCw className={cn("h-3 w-3", checkingUpdate && "animate-spin")} />
              Check for updates
            </button>
          </Section>

        </div>
      </div>
    </div>
  );
}

function cn(...cls: (string | boolean | undefined)[]) {
  return cls.filter(Boolean).join(" ");
}
