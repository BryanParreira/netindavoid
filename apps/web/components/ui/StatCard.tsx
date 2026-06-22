import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string | number;
  sub?: string;
  icon?: LucideIcon;
  accent?: "brand" | "blue" | "green" | "red" | "orange" | "violet";
  className?: string;
}

const ACCENT: Record<string, {
  icon: string;
  value: string;
  glow: string;
  dot: string;
}> = {
  brand:  {
    icon:  "bg-brand-500/15 text-brand-400",
    value: "text-foreground",
    glow:  "group-hover:shadow-brand-500/10",
    dot:   "bg-brand-500",
  },
  blue:   {
    icon:  "bg-blue-500/15 text-blue-400",
    value: "text-foreground",
    glow:  "group-hover:shadow-blue-500/10",
    dot:   "bg-blue-500",
  },
  green:  {
    icon:  "bg-emerald-500/15 text-emerald-400",
    value: "text-foreground",
    glow:  "group-hover:shadow-emerald-500/10",
    dot:   "bg-emerald-500",
  },
  red:    {
    icon:  "bg-red-500/15 text-red-400",
    value: "text-foreground",
    glow:  "group-hover:shadow-red-500/10",
    dot:   "bg-red-500",
  },
  orange: {
    icon:  "bg-orange-500/15 text-orange-400",
    value: "text-foreground",
    glow:  "group-hover:shadow-orange-500/10",
    dot:   "bg-orange-500",
  },
  violet: {
    icon:  "bg-violet-500/15 text-violet-400",
    value: "text-foreground",
    glow:  "group-hover:shadow-violet-500/10",
    dot:   "bg-violet-500",
  },
};

export function StatCard({ title, value, sub, icon: Icon, accent = "brand", className }: StatCardProps) {
  const a = ACCENT[accent] ?? ACCENT.brand;
  return (
    <div className={cn(
      "group relative rounded-xl border border-border bg-card p-5",
      "transition-all duration-200 hover:border-border/60",
      "hover:shadow-lg",
      a.glow,
      className,
    )}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-2 mb-4">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          {title}
        </p>
        {Icon && (
          <div className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", a.icon)}>
            <Icon className="h-3.5 w-3.5" strokeWidth={2} />
          </div>
        )}
      </div>

      {/* Value */}
      <p className="text-2xl font-bold tabular-nums tracking-tight text-foreground">
        {value}
      </p>

      {/* Sub */}
      {sub && (
        <p className="mt-1.5 text-[11px] text-muted-foreground leading-relaxed">{sub}</p>
      )}

      {/* Bottom accent line */}
      <div className={cn("absolute bottom-0 left-4 right-4 h-px rounded-full opacity-0 transition-opacity duration-200 group-hover:opacity-100", a.dot)} />
    </div>
  );
}
