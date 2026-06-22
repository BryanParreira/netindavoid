"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useAlertsStore } from "@/store/alerts";
import Image from "next/image";
import {
  Search, LayoutDashboard, Bell, FileText, Database,
  Shield, Globe, Wifi, ScanSearch, BotMessageSquare,
  Monitor, Activity, Map, CheckCircle2, Network,
  ScanLine, Aperture, ShieldAlert, Settings,
  ChevronLeft, ChevronRight, Radar,
} from "lucide-react";

// ── Nav definition ────────────────────────────────────────────────────────────

const NAV = [
  {
    section: null,
    items: [
      { href: "/logs",       label: "Search & Reporting", icon: Search          },
      { href: "/dashboards", label: "Dashboards",         icon: LayoutDashboard },
      { href: "/threats",    label: "Alerts",             icon: Bell, badge: true },
      { href: "/reports",    label: "Reports",            icon: FileText        },
      { href: "/",           label: "Overview",           icon: Database        },
    ],
  },
  {
    section: "Security",
    items: [
      { href: "/threats",  label: "Threats",       icon: Shield,          badge: true },
      { href: "/dns",      label: "DNS Monitor",   icon: Globe                        },
      { href: "/wifi",     label: "WiFi Intel",    icon: Radar                        },
      { href: "/audit",    label: "Audit Scanner", icon: ScanSearch                   },
      { href: "/ai",       label: "AI Assistant",  icon: BotMessageSquare             },
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
      { href: "/scanner",  label: "Nmap Scanner",   icon: ScanLine   },
      { href: "/capture",  label: "Packet Capture", icon: Aperture   },
      { href: "/vulnscan", label: "Vuln Scanner",   icon: ShieldAlert },
    ],
  },
];

// ── Sidebar ───────────────────────────────────────────────────────────────────

export function Sidebar() {
  const pathname   = usePathname();
  const unread     = useAlertsStore((s) => s.unreadCount);
  const [collapsed, setCollapsed] = useState(false);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <aside
      className={cn(
        "relative flex h-screen flex-col shrink-0 border-r transition-all duration-200",
        collapsed ? "w-[52px]" : "w-[216px]",
      )}
      style={{
        background: "hsl(var(--sidebar-bg, 240 7% 7%))",
        borderColor: "hsl(var(--sidebar-border, 240 4% 13%))",
      }}
    >
      {/* ── Logo ── */}
      <div
        className="flex h-[52px] shrink-0 items-center gap-3 border-b px-3"
        style={{ borderColor: "hsl(var(--sidebar-border, 240 4% 13%))" }}
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm overflow-hidden">
          <Image src="/logo.png" alt="Netindavoid" width={32} height={32} priority />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="text-[13px] font-bold text-white leading-none tracking-tight truncate">
              Netindavoid
            </p>
            <p className="text-[9px] mt-0.5 font-semibold uppercase tracking-widest"
               style={{ color: "#7c3aed" }}>
              Security
            </p>
          </div>
        )}
      </div>

      {/* ── Navigation ── */}
      <nav className="flex-1 overflow-y-auto scrollbar-thin py-3 px-1.5 space-y-0.5">
        {NAV.map((group, gi) => (
          <div key={gi} className={gi > 0 ? "mt-4" : ""}>
            {group.section && !collapsed && (
              <p className="mb-1 mt-1 px-2 text-[9px] font-bold uppercase tracking-widest"
                 style={{ color: "hsl(240 4% 32%)" }}>
                {group.section}
              </p>
            )}
            {group.section && !collapsed && (
              <div className="mb-1.5 mx-2 border-t" style={{ borderColor: "hsl(240 4% 14%)" }} />
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
                    "group relative flex items-center gap-2.5 rounded-sm px-2 py-[7px] text-[12px] font-medium transition-all",
                    active
                      ? "nav-active"
                      : "nav-hover text-[hsl(240_4%_50%)] hover:text-white",
                  )}
                >
                  <Icon
                    className={cn(
                      "h-3.5 w-3.5 shrink-0 transition-colors",
                      active ? "text-[#a78bfa]" : "text-[hsl(240_4%_38%)] group-hover:text-[#c4b5fd]",
                    )}
                  />
                  {!collapsed && (
                    <>
                      <span className="flex-1 truncate">{label}</span>
                      {badgeN > 0 && (
                        <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
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
           style={{ borderColor: "hsl(var(--sidebar-border, 240 4% 13%))" }}>
        <Link
          href="/settings"
          className={cn(
            "group flex items-center gap-2.5 rounded-sm px-2 py-[7px] text-[12px] font-medium transition-all",
            isActive("/settings") ? "nav-active" : "nav-hover text-[hsl(240_4%_46%)] hover:text-white",
          )}
        >
          <Settings className={cn("h-3.5 w-3.5 shrink-0", isActive("/settings") ? "text-[#a78bfa]" : "text-[hsl(240_4%_36%)] group-hover:text-[#c4b5fd]")} />
          {!collapsed && <span>Settings</span>}
        </Link>
      </div>

      {/* ── Collapse toggle ── */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="absolute -right-3 top-[62px] z-10 flex h-6 w-6 items-center justify-center rounded-full border transition-colors hover:border-[#7c3aed] hover:text-[#a78bfa]"
        style={{
          background: "hsl(240 6% 10%)",
          borderColor: "hsl(240 4% 18%)",
          color: "hsl(240 4% 38%)",
        }}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {collapsed
          ? <ChevronRight className="h-3 w-3" />
          : <ChevronLeft  className="h-3 w-3" />}
      </button>
    </aside>
  );
}
