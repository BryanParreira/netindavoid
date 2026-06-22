"use client";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
const format = (d: Date, fmt: string) => {
  if (fmt === "HH:mm") return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " · " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};
import { formatBytes } from "@/lib/utils";

interface DataPoint { ts: string; bytes_in: number; bytes_out: number; }

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2.5 text-xs shadow-xl">
      <p className="mb-1.5 font-medium text-muted-foreground">
        {format(new Date(label), "MMM d · HH:mm")}
      </p>
      <div className="space-y-1">
        <p className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-violet-500" />
          <span className="text-foreground">↓ {formatBytes(payload[0]?.value ?? 0)}</span>
        </p>
        <p className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
          <span className="text-foreground">↑ {formatBytes(payload[1]?.value ?? 0)}</span>
        </p>
      </div>
    </div>
  );
};

export function BandwidthChart({ data, height = 200 }: { data: DataPoint[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
        <defs>
          {/* violet for download, blue for upload */}
          <linearGradient id="gradIn" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#8b5cf6" stopOpacity={0.30} />
            <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gradOut" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#60a5fa" stopOpacity={0.22} />
            <stop offset="95%" stopColor="#60a5fa" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis
          dataKey="ts"
          tickFormatter={(v) => format(new Date(v), "HH:mm")}
          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
          axisLine={false} tickLine={false} interval="preserveStartEnd"
        />
        <YAxis
          tickFormatter={(v) => formatBytes(v)}
          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
          axisLine={false} tickLine={false} width={62}
        />
        <Tooltip content={<CustomTooltip />} />
        <Area type="monotone" dataKey="bytes_in"  stroke="#8b5cf6" strokeWidth={1.5} fill="url(#gradIn)"  dot={false} />
        <Area type="monotone" dataKey="bytes_out" stroke="#60a5fa" strokeWidth={1.5} fill="url(#gradOut)" dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
