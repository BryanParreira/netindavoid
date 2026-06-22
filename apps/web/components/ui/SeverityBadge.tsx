import { cn } from "@/lib/utils";

const CFG: Record<string, { dot: string; text: string; bg: string }> = {
  critical: { dot: "bg-red-500",     text: "text-red-400",     bg: "bg-red-500/10 border-red-500/20" },
  high:     { dot: "bg-orange-500",  text: "text-orange-400",  bg: "bg-orange-500/10 border-orange-500/20" },
  medium:   { dot: "bg-yellow-400",  text: "text-yellow-400",  bg: "bg-yellow-400/10 border-yellow-400/20" },
  low:      { dot: "bg-emerald-500", text: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
  info:     { dot: "bg-blue-500",    text: "text-blue-400",    bg: "bg-blue-500/10 border-blue-500/20" },
};

export function SeverityBadge({ severity }: { severity: string }) {
  const c = CFG[severity] ?? { dot: "bg-muted-foreground", text: "text-muted-foreground", bg: "bg-muted border-border" };
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-semibold", c.bg, c.text)}>
      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", c.dot)} />
      {severity.charAt(0).toUpperCase() + severity.slice(1)}
    </span>
  );
}
