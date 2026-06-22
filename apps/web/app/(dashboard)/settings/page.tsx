"use client";
import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { TopBar } from "@/components/layout/TopBar";
import toast from "react-hot-toast";
import { Server, Network, Cpu, RefreshCw, Loader2 } from "lucide-react";

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

  useEffect(() => {
    setApiUrl(process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000");
    fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/version`)
      .then(r => r.json()).then(setVersion).catch(() => {});
  }, []);

  const saveNetwork = async () => {
    try {
      // Store CIDR in localStorage for now (no backend config endpoint needed)
      localStorage.setItem("scan_cidr", scanCidr);
      toast.success("Network config saved");
    } catch { toast.error("Save failed"); }
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

          <Section icon={Cpu} title="AI Provider">
            <p className="text-[11px]" style={{ color: "hsl(240 4% 44%)" }}>
              Configure AI model in the{" "}
              <a href="/ai" className="underline" style={{ color: "#a78bfa" }}>AI Assistant</a>{" "}
              page — click the provider button in the top-right corner.
            </p>
          </Section>

          <Section icon={Server} title="About">
            <div className="space-y-1 text-[11px] font-mono" style={{ color: "hsl(240 4% 44%)" }}>
              <p>Netindavoid v1.0.0</p>
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
