import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string | number;
  sub?: string;
  icon?: LucideIcon;
  trend?: "up" | "down" | "flat";
  accentColor?: string;
  className?: string;
}

export function StatCard({ title, value, sub, icon: Icon, trend, accentColor = "text-brand-400", className }: StatCardProps) {
  return (
    <div className={cn(
      "rounded-xl border border-border bg-card p-5 transition-colors hover:border-brand-500/30",
      className
    )}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="mb-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">{title}</p>
          <p className={cn("text-2xl font-bold tabular-nums leading-none", accentColor)}>{value}</p>
          {sub && <p className="mt-1.5 text-xs text-muted-foreground">{sub}</p>}
        </div>
        {Icon && (
          <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted", accentColor)}>
            <Icon className="h-5 w-5" />
          </div>
        )}
      </div>
    </div>
  );
}
