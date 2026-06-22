import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}

export function formatMbps(mbps: number): string {
  if (mbps < 0.01) return "< 0.01 Mbps";
  if (mbps >= 1000) return `${(mbps / 1000).toFixed(2)} Gbps`;
  return `${mbps.toFixed(2)} Mbps`;
}

export function severityColor(severity: string): string {
  const map: Record<string, string> = {
    critical: "text-red-400",
    high: "text-orange-400",
    medium: "text-yellow-400",
    low: "text-green-400",
    info: "text-blue-400",
  };
  return map[severity] ?? "text-muted-foreground";
}

export function severityBg(severity: string): string {
  const map: Record<string, string> = {
    critical: "bg-red-500/15 border-red-500/30",
    high: "bg-orange-500/15 border-orange-500/30",
    medium: "bg-yellow-500/15 border-yellow-500/30",
    low: "bg-green-500/15 border-green-500/30",
    info: "bg-blue-500/15 border-blue-500/30",
  };
  return map[severity] ?? "bg-muted/50 border-border";
}

export function deviceIcon(category: string): string {
  const map: Record<string, string> = {
    computer: "💻",
    mobile: "📱",
    iot: "🔌",
    network: "🌐",
    media: "📺",
    guest: "👤",
    unknown: "❓",
  };
  return map[category] ?? "❓";
}

export function timeAgo(date: string | Date): string {
  const d = new Date(date);
  const now = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
