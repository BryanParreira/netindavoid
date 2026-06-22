"use client";
import { useState } from "react";
import useSWR from "swr";
import { api } from "@/lib/api";
import { TopBar } from "@/components/layout/TopBar";
import { StatCard } from "@/components/ui/StatCard";
import { cn } from "@/lib/utils";
import { Globe, ShieldOff, Activity, Search } from "lucide-react";

const fetcher = (url: string) => api.get(url).then((r) => r.data);

export default function DnsPage() {
  const [hours, setHours]   = useState(24);
  const [search, setSearch] = useState("");

  const { data: overview } = useSWR(`/dns/overview?hours=${hours}`, fetcher, { refreshInterval: 30_000 });
  const { data: queries }  = useSWR(
    `/dns/queries?hours=${hours}&limit=100${search ? `&domain=${search}` : ""}`,
    fetcher,
    { refreshInterval: 20_000 }
  );

  return (
    <div className="flex flex-col overflow-hidden">
      <TopBar title="DNS" subtitle="Query analysis and blocklist activity" />

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="space-y-4 p-5">

          {/* Time filter */}
          <div className="flex items-center gap-1.5">
            {[1, 6, 24, 72].map((h) => (
              <button
                key={h}
                onClick={() => setHours(h)}
                className={cn(
                  "rounded-full px-3 py-1 text-[11px] font-semibold transition-colors",
                  hours === h ? "bg-brand-500 text-white" : "bg-muted text-muted-foreground hover:text-foreground"
                )}
              >
                {h}h
              </button>
            ))}
          </div>

          {/* Stat cards */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard title="Total Queries"   value={overview?.total?.toLocaleString() ?? "—"} icon={Globe}     accent="brand"  />
            <StatCard title="Unique Domains"  value={overview?.unique_domains?.toLocaleString() ?? "—"} icon={Activity} accent="blue"   />
            <StatCard title="Blocked"         value={overview?.blocked?.toLocaleString() ?? "—"} sub={`${overview?.block_rate ?? 0}% block rate`} icon={ShieldOff} accent="orange" />
            <StatCard title="Malicious"       value={overview?.malicious?.toLocaleString() ?? "—"} icon={ShieldOff} accent="red" />
          </div>

          {/* Top domains side by side */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-border bg-card">
              <div className="border-b border-border px-5 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Top Queried</p>
              </div>
              <div className="divide-y divide-border">
                {(overview?.top_domains ?? []).map((d: any) => (
                  <div key={d.domain} className="flex items-center gap-2 px-5 py-2.5 text-xs">
                    {d.blocked && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />}
                    <span className="min-w-0 flex-1 truncate font-mono text-foreground">{d.domain}</span>
                    <span className="shrink-0 font-mono tabular-nums text-muted-foreground">{d.count.toLocaleString()}</span>
                  </div>
                ))}
                {!overview?.top_domains?.length && (
                  <p className="px-5 py-4 text-xs text-muted-foreground">No data yet</p>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card">
              <div className="border-b border-border px-5 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Top Blocked</p>
              </div>
              <div className="divide-y divide-border">
                {(overview?.top_blocked ?? []).map((d: any) => (
                  <div key={d.domain} className="flex items-center gap-2 px-5 py-2.5 text-xs">
                    <span className="min-w-0 flex-1 truncate font-mono text-red-500 dark:text-red-400">{d.domain}</span>
                    <span className="shrink-0 font-mono tabular-nums text-muted-foreground">{d.count.toLocaleString()}</span>
                  </div>
                ))}
                {!overview?.top_blocked?.length && (
                  <p className="px-5 py-4 text-xs text-muted-foreground">No blocked domains</p>
                )}
              </div>
            </div>
          </div>

          {/* Query log */}
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="flex items-center gap-3 border-b border-border px-5 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Query Log</p>
              <div className="relative ml-auto">
                <Search className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Filter domain…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-7 w-48 rounded-md border border-border bg-muted pl-7 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/30"
                />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    {["Domain", "Type", "Response", "Status", "Time"].map((h) => (
                      <th key={h} className="whitespace-nowrap px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(queries ?? []).map((q: any) => (
                    <tr key={q.id} className="hover:bg-accent/30 transition-colors">
                      <td className={cn(
                        "px-4 py-2.5 font-mono",
                        q.is_malicious ? "text-red-500 dark:text-red-400" :
                        q.is_blocked   ? "text-orange-500 dark:text-orange-400" :
                                         "text-foreground"
                      )}>
                        {q.domain}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-muted-foreground">{q.query_type}</td>
                      <td className="px-4 py-2.5 font-mono text-muted-foreground">{q.response_code}</td>
                      <td className="px-4 py-2.5">
                        {q.is_malicious
                          ? <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-[11px] font-semibold text-red-500 dark:text-red-400">Malicious</span>
                          : q.is_blocked
                          ? <span className="rounded bg-orange-500/10 px-1.5 py-0.5 text-[11px] font-semibold text-orange-500">Blocked</span>
                          : null}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-muted-foreground">
                        {new Date(q.queried_at).toLocaleTimeString()}
                      </td>
                    </tr>
                  ))}
                  {!(queries ?? []).length && (
                    <tr>
                      <td colSpan={5} className="px-4 py-12 text-center">
                        <Globe className="mx-auto mb-2 h-8 w-8 text-muted-foreground/20" />
                        <p className="text-xs text-muted-foreground">No queries in this time range</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
