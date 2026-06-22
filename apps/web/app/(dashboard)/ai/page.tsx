"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { TopBar } from "@/components/layout/TopBar";
import { cn } from "@/lib/utils";
import {
  Send, RotateCcw, Copy, Check, Settings2, X,
  Cpu, Cloud, Loader2, RefreshCw, ChevronDown,
} from "lucide-react";
import toast from "react-hot-toast";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Message { role: "user" | "assistant"; content: string; model?: string; }

interface AiConfig {
  provider: string;
  ollama_url: string;
  ollama_model: string;
  lmstudio_url: string;
  lmstudio_model: string;
  openai_key: string;
  openai_model: string;
  anthropic_key: string;
  anthropic_model: string;
  custom_url: string;
  custom_model: string;
  custom_key: string;
}

const DEFAULT_CFG: AiConfig = {
  provider: "ollama",
  ollama_url: "http://localhost:11434", ollama_model: "llama3.2",
  lmstudio_url: "http://localhost:1234", lmstudio_model: "",
  openai_key: "", openai_model: "gpt-4o-mini",
  anthropic_key: "", anthropic_model: "claude-haiku-4-5-20251001",
  custom_url: "", custom_model: "", custom_key: "",
};

const PROVIDERS = [
  { id: "ollama",    label: "Ollama",     type: "local", desc: "Local LLM server" },
  { id: "lmstudio",  label: "LM Studio",  type: "local", desc: "Local LLM server" },
  { id: "openai",    label: "OpenAI",     type: "cloud", desc: "GPT-4o / GPT-4o-mini" },
  { id: "anthropic", label: "Anthropic",  type: "cloud", desc: "Claude models" },
  { id: "custom",    label: "Custom",     type: "cloud", desc: "OpenAI-compatible API" },
];

const STARTERS = [
  { label: "Bandwidth hog",   prompt: "What device is using the most bandwidth right now?" },
  { label: "Recent threats",  prompt: "Summarize all open alerts from the last 24 hours." },
  { label: "Unknown devices", prompt: "Are there any unrecognized devices on my network?" },
  { label: "Suspicious DNS",  prompt: "Were there any suspicious DNS lookups recently?" },
];

// ── Field components ──────────────────────────────────────────────────────────

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="space-y-1.5">
    <label className="block text-[10px] font-semibold uppercase tracking-widest"
           style={{ color: "hsl(240 4% 42%)" }}>{label}</label>
    {children}
  </div>
);

const Input = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input
    {...props}
    className="w-full rounded-sm border px-3 py-2 text-[12px] font-mono outline-none transition-colors focus:border-[#8b5cf6]"
    style={{ background: "hsl(240 7% 6%)", borderColor: "hsl(240 4% 18%)", color: "hsl(240 5% 84%)", ...props.style }}
  />
);

// ── Config panel ──────────────────────────────────────────────────────────────

function ConfigPanel({ onClose }: { onClose: () => void }) {
  const [cfg, setCfg]         = useState<AiConfig>(DEFAULT_CFG);
  const [models, setModels]   = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    api.get("/ai/config").then(r => { setCfg(r.data); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const fetchModels = async () => {
    setFetching(true);
    try {
      const { data } = await api.get("/ai/models");
      setModels(data.models || []);
      if (!data.models?.length) toast.error("No models found — is the server running?");
    } catch { toast.error("Cannot reach AI server"); }
    finally { setFetching(false); }
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.post("/ai/config", cfg);
      toast.success("AI config saved");
      onClose();
    } catch { toast.error("Save failed"); }
    finally { setSaving(false); }
  };

  const set = (k: keyof AiConfig, v: string) => setCfg(c => ({ ...c, [k]: v }));

  if (loading) return (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin" style={{ color: "#8b5cf6" }} />
    </div>
  );

  const p = cfg.provider;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-5 py-4"
           style={{ borderColor: "hsl(240 4% 16%)" }}>
        <div>
          <p className="text-[13px] font-bold text-white">AI Provider Settings</p>
          <p className="text-[10px]" style={{ color: "hsl(240 4% 42%)" }}>
            Local models (Ollama / LM Studio) or cloud API
          </p>
        </div>
        <button onClick={onClose} className="btn-ghost p-1 rounded-sm">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin p-5 space-y-5">

        {/* Provider selector */}
        <Field label="Provider">
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {PROVIDERS.map(pr => (
              <button
                key={pr.id}
                onClick={() => set("provider", pr.id)}
                className={cn(
                  "flex flex-col items-start gap-0.5 rounded-sm border p-2.5 text-left text-[11px] transition-all",
                  cfg.provider === pr.id
                    ? "border-[#8b5cf6] bg-[rgba(139,92,246,0.1)]"
                    : "hover:border-[hsl(240_4%_24%)] hover:bg-white/3"
                )}
                style={{
                  borderColor: cfg.provider === pr.id ? "#8b5cf6" : "hsl(240 4% 18%)",
                }}
              >
                <div className="flex items-center gap-1.5">
                  {pr.type === "local"
                    ? <Cpu className="h-3 w-3" style={{ color: cfg.provider === pr.id ? "#a78bfa" : "hsl(240 4% 42%)" }} />
                    : <Cloud className="h-3 w-3" style={{ color: cfg.provider === pr.id ? "#a78bfa" : "hsl(240 4% 42%)" }} />
                  }
                  <span className={cfg.provider === pr.id ? "text-[#c4b5fd] font-semibold" : "text-white/70"}>
                    {pr.label}
                  </span>
                </div>
                <span className="text-[9px]" style={{ color: "hsl(240 4% 36%)" }}>{pr.desc}</span>
              </button>
            ))}
          </div>
        </Field>

        {/* ── Ollama ── */}
        {p === "ollama" && (
          <div className="space-y-3">
            <Field label="Ollama Server URL">
              <Input value={cfg.ollama_url} onChange={e => set("ollama_url", e.target.value)}
                     placeholder="http://localhost:11434" />
            </Field>
            <Field label="Model">
              <div className="flex gap-2">
                {models.length > 0 ? (
                  <select
                    value={cfg.ollama_model}
                    onChange={e => set("ollama_model", e.target.value)}
                    className="flex-1 rounded-sm border px-3 py-2 text-[12px] font-mono outline-none focus:border-[#8b5cf6]"
                    style={{ background: "hsl(240 7% 6%)", borderColor: "hsl(240 4% 18%)", color: "hsl(240 5% 84%)" }}
                  >
                    {models.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                ) : (
                  <Input value={cfg.ollama_model} onChange={e => set("ollama_model", e.target.value)}
                         placeholder="llama3.2" />
                )}
                <button onClick={fetchModels} disabled={fetching}
                  className="flex items-center gap-1.5 rounded-sm border px-3 py-2 text-[11px] transition-colors hover:bg-white/5 shrink-0"
                  style={{ borderColor: "hsl(240 4% 18%)", color: "hsl(240 4% 52%)" }}>
                  <RefreshCw className={cn("h-3 w-3", fetching && "animate-spin")} />
                  {models.length ? `${models.length} models` : "Fetch"}
                </button>
              </div>
            </Field>
            <p className="text-[10px] rounded-sm border px-3 py-2"
               style={{ borderColor: "hsl(240 4% 16%)", background: "hsl(240 7% 6%)", color: "hsl(240 4% 42%)" }}>
              Ollama must be running: <span className="font-mono text-[#a78bfa]">ollama serve</span>
              <br/>Install models: <span className="font-mono text-[#a78bfa]">ollama pull llama3.2</span>
            </p>
          </div>
        )}

        {/* ── LM Studio ── */}
        {p === "lmstudio" && (
          <div className="space-y-3">
            <Field label="LM Studio Server URL">
              <Input value={cfg.lmstudio_url} onChange={e => set("lmstudio_url", e.target.value)}
                     placeholder="http://localhost:1234" />
            </Field>
            <Field label="Model">
              <div className="flex gap-2">
                {models.length > 0 ? (
                  <select
                    value={cfg.lmstudio_model}
                    onChange={e => set("lmstudio_model", e.target.value)}
                    className="flex-1 rounded-sm border px-3 py-2 text-[12px] font-mono outline-none focus:border-[#8b5cf6]"
                    style={{ background: "hsl(240 7% 6%)", borderColor: "hsl(240 4% 18%)", color: "hsl(240 5% 84%)" }}
                  >
                    {models.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                ) : (
                  <Input value={cfg.lmstudio_model} onChange={e => set("lmstudio_model", e.target.value)}
                         placeholder="Leave blank to auto-detect" />
                )}
                <button onClick={fetchModels} disabled={fetching}
                  className="flex items-center gap-1.5 rounded-sm border px-3 py-2 text-[11px] transition-colors hover:bg-white/5 shrink-0"
                  style={{ borderColor: "hsl(240 4% 18%)", color: "hsl(240 4% 52%)" }}>
                  <RefreshCw className={cn("h-3 w-3", fetching && "animate-spin")} />
                  {models.length ? `${models.length} models` : "Fetch"}
                </button>
              </div>
            </Field>
            <p className="text-[10px] rounded-sm border px-3 py-2"
               style={{ borderColor: "hsl(240 4% 16%)", background: "hsl(240 7% 6%)", color: "hsl(240 4% 42%)" }}>
              In LM Studio → Local Server → Start Server. Port must match URL above.
            </p>
          </div>
        )}

        {/* ── OpenAI ── */}
        {p === "openai" && (
          <div className="space-y-3">
            <Field label="API Key">
              <Input type="password" value={cfg.openai_key} onChange={e => set("openai_key", e.target.value)}
                     placeholder="sk-..." />
            </Field>
            <Field label="Model">
              <select value={cfg.openai_model} onChange={e => set("openai_model", e.target.value)}
                className="w-full rounded-sm border px-3 py-2 text-[12px] font-mono outline-none focus:border-[#8b5cf6]"
                style={{ background: "hsl(240 7% 6%)", borderColor: "hsl(240 4% 18%)", color: "hsl(240 5% 84%)" }}>
                {["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"].map(m =>
                  <option key={m} value={m}>{m}</option>)}
              </select>
            </Field>
          </div>
        )}

        {/* ── Anthropic ── */}
        {p === "anthropic" && (
          <div className="space-y-3">
            <Field label="API Key">
              <Input type="password" value={cfg.anthropic_key} onChange={e => set("anthropic_key", e.target.value)}
                     placeholder="sk-ant-..." />
            </Field>
            <Field label="Model">
              <select value={cfg.anthropic_model} onChange={e => set("anthropic_model", e.target.value)}
                className="w-full rounded-sm border px-3 py-2 text-[12px] font-mono outline-none focus:border-[#8b5cf6]"
                style={{ background: "hsl(240 7% 6%)", borderColor: "hsl(240 4% 18%)", color: "hsl(240 5% 84%)" }}>
                {["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"].map(m =>
                  <option key={m} value={m}>{m}</option>)}
              </select>
            </Field>
          </div>
        )}

        {/* ── Custom ── */}
        {p === "custom" && (
          <div className="space-y-3">
            <Field label="Base URL (OpenAI-compatible)">
              <Input value={cfg.custom_url} onChange={e => set("custom_url", e.target.value)}
                     placeholder="https://api.example.com" />
            </Field>
            <Field label="API Key (optional)">
              <Input type="password" value={cfg.custom_key} onChange={e => set("custom_key", e.target.value)}
                     placeholder="Bearer token or API key" />
            </Field>
            <Field label="Model ID">
              <Input value={cfg.custom_model} onChange={e => set("custom_model", e.target.value)}
                     placeholder="model-name" />
            </Field>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t px-5 py-4 flex justify-end gap-2"
           style={{ borderColor: "hsl(240 4% 16%)" }}>
        <button onClick={onClose}
          className="rounded-sm border px-4 py-2 text-[12px] transition-colors hover:bg-white/5"
          style={{ borderColor: "hsl(240 4% 18%)", color: "hsl(240 4% 52%)" }}>
          Cancel
        </button>
        <button onClick={save} disabled={saving}
          className="rounded-sm px-5 py-2 text-[12px] font-semibold text-white transition-colors hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
          style={{ background: "#7c3aed" }}>
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Save
        </button>
      </div>
    </div>
  );
}

// ── Chat components ───────────────────────────────────────────────────────────

function UserBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[82%] rounded-2xl rounded-tr-sm px-4 py-2.5 text-[13px] leading-relaxed text-white"
           style={{ background: "#7c3aed" }}>
        {content}
      </div>
    </div>
  );
}

function AssistantBubble({ content, model }: { content: string; model?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="group flex gap-3 max-w-[92%]">
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white"
           style={{ background: "#8b5cf6" }}>
        <Cpu className="h-3 w-3" />
      </div>
      <div className="min-w-0 flex-1">
        {model && (
          <p className="mb-1 text-[10px]" style={{ color: "hsl(240 4% 42%)" }}>{model}</p>
        )}
        <div className="text-[13px] leading-relaxed" style={{ color: "hsl(240 5% 82%)" }}>
          {content.split("\n\n").map((para, i) => (
            <p key={i} className={i > 0 ? "mt-3" : ""}>{para}</p>
          ))}
        </div>
        <button
          onClick={() => { navigator.clipboard.writeText(content); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
          className="mt-2 flex items-center gap-1 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ color: "hsl(240 4% 46%)" }}
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

function TypingDots() {
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white"
           style={{ background: "#8b5cf6" }}>
        <Loader2 className="h-3 w-3 animate-spin" />
      </div>
      <div className="flex items-center gap-1 py-1">
        {[0,1,2].map(i => (
          <span key={i} className="h-1.5 w-1.5 rounded-full animate-pulse-dot"
                style={{ background: "hsl(240 4% 40%)", animationDelay: `${i*0.18}s` }} />
        ))}
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function AiPage() {
  const [messages, setMessages]   = useState<Message[]>([]);
  const [input, setInput]         = useState("");
  const [loading, setLoading]     = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [providerLabel, setProviderLabel] = useState("Ollama");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    api.get("/ai/config").then(r => {
      const p = PROVIDERS.find(pr => pr.id === r.data.provider);
      if (p) setProviderLabel(p.label);
    }).catch(() => {});
  }, [showConfig]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const send = useCallback(async (question: string) => {
    const q = question.trim();
    if (!q || loading) return;
    setInput("");
    setMessages(m => [...m, { role: "user", content: q }]);
    setLoading(true);
    try {
      const { data } = await api.post("/ai/query", { question: q });
      setMessages(m => [...m, { role: "assistant", content: data.answer, model: data.model }]);
    } catch (err: any) {
      const detail = err?.response?.data?.detail ?? "AI unavailable. Check provider settings.";
      setMessages(m => [...m, { role: "assistant", content: detail }]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [loading]);

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); }
  };

  const isEmpty = messages.length === 0;

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Chat panel ── */}
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        <TopBar
          title="AI Assistant"
          actions={
            <div className="flex items-center gap-2">
              {!isEmpty && (
                <button onClick={() => setMessages([])}
                  className="flex items-center gap-1.5 rounded-sm border px-3 h-7 text-[11px] transition-colors hover:bg-white/5"
                  style={{ borderColor: "hsl(240 4% 18%)", color: "hsl(240 4% 50%)" }}>
                  <RotateCcw className="h-3 w-3" /> New chat
                </button>
              )}
              <button onClick={() => setShowConfig(c => !c)}
                className={cn(
                  "flex items-center gap-1.5 rounded-sm border px-3 h-7 text-[11px] transition-colors",
                  showConfig ? "border-[#8b5cf6] text-[#a78bfa] bg-[rgba(139,92,246,0.1)]" : "hover:bg-white/5"
                )}
                style={showConfig ? {} : { borderColor: "hsl(240 4% 18%)", color: "hsl(240 4% 50%)" }}>
                <Settings2 className="h-3 w-3" />
                <span>{providerLabel}</span>
                <ChevronDown className="h-3 w-3 opacity-60" />
              </button>
            </div>
          }
        />

        {/* Messages */}
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          <div className="mx-auto max-w-2xl px-4 py-6">

            {isEmpty && (
              <div className="text-center mb-8">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full"
                     style={{ background: "rgba(139,92,246,0.15)", border: "1px solid rgba(139,92,246,0.3)" }}>
                  <Cpu className="h-6 w-6" style={{ color: "#a78bfa" }} />
                </div>
                <h2 className="text-[15px] font-semibold text-white mb-1">Network Security AI</h2>
                <p className="text-[12px]" style={{ color: "hsl(240 4% 46%)" }}>
                  Ask anything about your network — using {providerLabel}
                </p>
                <div className="mt-6 grid grid-cols-2 gap-2 text-left">
                  {STARTERS.map(({ label, prompt }) => (
                    <button key={label} onClick={() => send(prompt)}
                      className="flex flex-col gap-1.5 rounded-sm border p-3.5 text-left transition-all hover:border-[#8b5cf6]/50 hover:bg-[rgba(139,92,246,0.06)]"
                      style={{ borderColor: "hsl(240 4% 16%)", background: "hsl(240 5% 11%)" }}>
                      <p className="text-[11px] font-semibold text-white">{label}</p>
                      <p className="text-[10px]" style={{ color: "hsl(240 4% 42%)" }}>{prompt}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {!isEmpty && (
              <div className="space-y-5">
                {messages.map((m, i) =>
                  m.role === "user"
                    ? <UserBubble key={i} content={m.content} />
                    : <AssistantBubble key={i} content={m.content} model={m.model} />
                )}
                {loading && <TypingDots />}
                <div ref={bottomRef} />
              </div>
            )}
          </div>
        </div>

        {/* Input */}
        <div className="border-t px-4 py-3" style={{ borderColor: "hsl(240 4% 14%)", background: "hsl(240 6% 8%)" }}>
          <div className="mx-auto max-w-2xl">
            <div className="flex items-end gap-2 rounded-sm border px-4 py-3 transition-colors focus-within:border-[#8b5cf6]"
                 style={{ background: "hsl(240 5% 11%)", borderColor: "hsl(240 4% 18%)" }}>
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                onChange={e => { setInput(e.target.value); e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px"; }}
                onKeyDown={handleKey}
                placeholder="Ask about your network…"
                disabled={loading}
                className="flex-1 resize-none bg-transparent text-[13px] placeholder:text-[hsl(240_4%_32%)] outline-none disabled:opacity-50"
                style={{ height: "22px", lineHeight: "22px", color: "hsl(240 5% 84%)" }}
              />
              <button onClick={() => send(input)} disabled={!input.trim() || loading}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-white transition-all disabled:opacity-30"
                style={{ background: "#7c3aed" }}>
                <Send className="h-3.5 w-3.5" />
              </button>
            </div>
            <p className="mt-1 text-center text-[10px]" style={{ color: "hsl(240 4% 30%)" }}>
              Enter to send · Shift+Enter new line
            </p>
          </div>
        </div>
      </div>

      {/* ── Config slide-in panel ── */}
      {showConfig && (
        <div className="w-[360px] shrink-0 border-l flex flex-col"
             style={{ borderColor: "hsl(240 4% 14%)", background: "hsl(240 6% 9%)" }}>
          <ConfigPanel onClose={() => setShowConfig(false)} />
        </div>
      )}
    </div>
  );
}
