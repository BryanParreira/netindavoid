"use client";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";

const COLORS: Record<string, string> = {
  critical: "#f87171",
  high:     "#fb923c",
  medium:   "#fbbf24",
  low:      "#4ade80",
  info:     "#60a5fa",
};

export function AlertsDonut({ data }: { data: Record<string, number> }) {
  const entries = Object.entries(data).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value }));
  const total   = entries.reduce((s, e) => s + e.value, 0);

  if (!entries.length) {
    return (
      <div className="flex h-36 flex-col items-center justify-center gap-1.5">
        <div className="h-10 w-10 rounded-full border-2 border-dashed border-border" />
        <p className="text-xs text-muted-foreground">No alerts</p>
      </div>
    );
  }

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={140}>
        <PieChart>
          <Pie data={entries} cx="50%" cy="50%" innerRadius={42} outerRadius={58}
            paddingAngle={3} dataKey="value" strokeWidth={0}>
            {entries.map((e) => <Cell key={e.name} fill={COLORS[e.name] ?? "#8b5cf6"} />)}
          </Pie>
          <Tooltip
            formatter={(v, name) => [v, (name as string).charAt(0).toUpperCase() + (name as string).slice(1)]}
            contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "12px" }}
          />
        </PieChart>
      </ResponsiveContainer>
      {/* Center label */}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-bold text-foreground">{total}</span>
        <span className="text-[10px] text-muted-foreground">total</span>
      </div>
    </div>
  );
}
