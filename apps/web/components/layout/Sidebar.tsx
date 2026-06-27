"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useAlertsStore } from "@/store/alerts";
import Image from "next/image";
import { api } from "@/lib/api";
import {
  Search, BarChart3, Home,
  Bell, Globe, Wifi, ScanSearch, BotMessageSquare,
  Monitor, Activity, Map, CheckCircle2, Network,
  ScanLine, Aperture, ShieldAlert, Settings,
  ChevronLeft, ChevronRight, Radar,
} from "lucide-react";

const NAV = [
  {
    section: null,
    items: [
      { href: "/",           label: "Overview",       icon: Home            },
      { href: "/logs",       label: "Log Search",     icon: Search          },
      { href: "/dashboards", label: "Log Analytics",  icon: BarChart3       },
    ],
  },
  {
    section: "Security",
    items: [
      { href: "/threats", label: "Alerts",        icon: Bell,            badge: true },
      { href: "/dns",     label: "DNS Monitor",   icon: Globe                        },
      { href: "/wifi",    label: "WiFi Intel",    icon: Radar                        },
      { href: "/audit",   label: "Audit Scanner", icon: ScanSearch                   },
      { href: "/ai",      label: "AI Assistant",  icon: BotMessageSquare             },
    ],
  },
  {
    section: "Network",
    items: [
      { href: "/devices", label: "Devices",     icon: Monitor      },
      { href: "/traffic", label: "Traffic",     icon: Activity     },
      { href: "/flows",   label: "Flows",       icon: Network      },
      { href: "/map",     label: "Network Map", icon: Map          },
      { href: "/uptime",  label: "Uptime",      icon: CheckCircle2 },
    ],
  },
  {
    section: "Tools",
    items: [
      { href: "/scanner",  label: "Nmap Scanner",   icon: ScanLine    },
      { href: "/capture",  label: "Packet Capture", icon: Aperture    },
      { href: "/vulnscan", label: "Vuln Scanner",   icon: ShieldAlert },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const unread   = useAlertsStore((s) => s.unreadCount);
  const [collapsed, setCollapsed] = useState(false);
  const [currentNetwork, setCurrentNetwork] = useState<any>(null);

  useEffect(() => {
    const fetchNetwork = async () => {
      try {
        const r = await api.get("/network/current");
        setCurrentNetwork(r.data.network);
      } catch {}
    };
    fetchNetwork();
    const interval = setInterval(fetchNetwork, 30_000);
    return () => clearInterval(interval);
  }, []);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <aside
      className={cn(
        "relative flex h-screen flex-col shrink-0 border-r transition-all duration-200",
        collapsed ? "w-[52px]" : "w-[220px]",
      )}
      style={{
        background:   "hsl(var(--sidebar-bg))",
        borderColor:  "hsl(var(--sidebar-border))",
      }}
    >
      {/* ── Traffic light drag zone (empty — macOS buttons render here) ── */}
      <div
        className="shrink-0"
        style={{
          height: "36px",
          WebkitAppRegion: "drag",
        } as React.CSSProperties}
      />

      {/* ── Logo — sits below traffic lights ── */}
      <div
        className="flex shrink-0 items-center gap-2.5 border-b px-3 pb-3"
        style={{
          borderColor:     "hsl(var(--sidebar-border))",
          WebkitAppRegion: "no-drag",
        } as React.CSSProperties}
      >
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg overflow-hidden">
          <Image src="/logo.png" alt="" width={28} height={28} priority />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="text-[13px] font-semibold leading-none tracking-tight truncate"
               style={{ color: "#ededed" }}>
              Vex
            </p>
            <p className="text-[9px] mt-1 font-bold uppercase tracking-[0.14em]"
               style={{ color: "#8b5cf6" }}>
              Security Monitor
            </p>
          </div>
        )}
      </div>

      {/* ── Navigation ── */}
      <nav className="flex-1 overflow-y-auto scrollbar-thin py-2 px-1.5 space-y-px">
        {NAV.map((group, gi) => (
          <div key={gi} className={gi > 0 ? "mt-3" : ""}>
            {group.section && !collapsed && (
              <>
                <p className="px-2 pt-1 pb-1 text-[9px] font-bold uppercase tracking-widest"
                   style={{ color: "#555" }}>
                  {group.section}
                </p>
                <div className="mb-1 mx-2 border-t" style={{ borderColor: "hsl(0 0% 14%)" }} />
              </>
            )}

            {group.items.map(({ href, label, icon: Icon, badge }: any) => {
              const active = isActive(href);
              const badgeN = badge ? unread : 0;
              return (
                <Link
                  key={`${gi}-${href}-${label}`}
                  href={href}
                  title={collapsed ? label : undefined}
                  className={cn(
                    "group relative flex items-center gap-2.5 rounded-[4px] px-2 py-[6px] text-[12px] font-medium transition-colors duration-100",
                    active
                      ? "nav-active"
                      : "nav-hover",
                  )}
                  style={!active ? { color: "#737373" } : undefined}
                >
                  <Icon
                    className={cn(
                      "h-3.5 w-3.5 shrink-0 transition-colors",
                      active
                        ? "text-[#a78bfa]"
                        : "group-hover:text-[#c4b5fd]",
                    )}
                    style={!active ? { color: "#555" } : undefined}
                  />
                  {!collapsed && (
                    <>
                      <span className="flex-1 truncate">{label}</span>
                      {badgeN > 0 && (
                        <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500/90 px-1 text-[9px] font-bold text-white">
                          {badgeN > 9 ? "9+" : badgeN}
                        </span>
                      )}
                    </>
                  )}
                  {collapsed && badgeN > 0 && (
                    <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-red-500" />
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* ── Settings ── */}
      <div className="shrink-0 border-t px-1.5 py-2"
           style={{ borderColor: "hsl(var(--sidebar-border))" }}>
        <Link
          href="/settings"
          className={cn(
            "group flex items-center gap-2.5 rounded-[4px] px-2 py-[6px] text-[12px] font-medium transition-colors duration-100",
            isActive("/settings") ? "nav-active" : "nav-hover",
          )}
          style={!isActive("/settings") ? { color: "#737373" } : undefined}
        >
          <Settings
            className={cn("h-3.5 w-3.5 shrink-0", isActive("/settings") ? "text-[#a78bfa]" : "group-hover:text-[#c4b5fd]")}
            style={!isActive("/settings") ? { color: "#555" } : undefined}
          />
          {!collapsed && <span>Settings</span>}
        </Link>
      </div>

      {/* ── Active network pill ── */}
      {!collapsed && currentNetwork && (
        <div
          className="mx-1.5 mb-1 rounded-[4px] px-2 py-2 border"
          style={{ borderColor: "hsl(240 4% 16%)", background: "hsl(240 5% 9%)" }}
        >
          <div className="flex items-center gap-1.5">
            <span
              className="h-1.5 w-1.5 rounded-full shrink-0"
              style={{
                background: currentNetwork.is_trusted ? "#22d3ee" : "#f59e0b",
              }}
            />
            <span className="text-[10px] truncate" style={{ color: "#737373" }}>
              {currentNetwork.display_name ||
                currentNetwork.ssid ||
                currentNetwork.subnet_cidr ||
                currentNetwork.gateway_mac}
            </span>
          </div>
        </div>
      )}

      {/* ── Collapse toggle ── */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="absolute -right-3 top-[62px] z-10 flex h-6 w-6 items-center justify-center rounded-full border transition-colors hover:border-[#7c3aed] hover:text-[#a78bfa]"
        style={{
          background:   "hsl(0 0% 12%)",
          borderColor:  "hsl(0 0% 20%)",
          color:        "hsl(0 0% 40%)",
        }}
        title={collapsed ? "Expand" : "Collapse"}
      >
        {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronLeft className="h-3 w-3" />}
      </button>
    </aside>
  );
}
