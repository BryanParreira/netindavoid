"use client";

interface TopBarProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  live?: boolean;
}

function LiveBadge() {
  return (
    <span className="flex items-center gap-1.5 rounded-sm border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
      </span>
      Live
    </span>
  );
}

export function TopBar({ title, subtitle, actions, live = false }: TopBarProps) {
  return (
    <header
      className="flex h-[48px] shrink-0 items-center justify-between border-b px-5"
      style={{ background: "hsl(240 6% 9%)", borderColor: "hsl(var(--border))" }}
    >
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 text-[12px]">
          <span className="font-semibold text-white">{title}</span>
          {subtitle && (
            <>
              <span style={{ color: "hsl(240 4% 30%)" }}>/</span>
              <span style={{ color: "hsl(240 4% 46%)" }}>{subtitle}</span>
            </>
          )}
        </div>
        {live && <LiveBadge />}
      </div>

      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}
