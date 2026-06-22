"use client";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { api } from "@/lib/api";
import { TopBar } from "@/components/layout/TopBar";
import { deviceIcon } from "@/lib/utils";

const fetcher = (url: string) => api.get(url).then((r) => r.data);

export default function MapPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { data } = useSWR("/devices?limit=200", fetcher, { refreshInterval: 10_000 });
  const [ForceGraph, setForceGraph] = useState<any>(null);

  useEffect(() => {
    // Lazy-load react-force-graph (client-only, uses WebGL)
    import("react-force-graph-2d").then((m) => setForceGraph(() => m.default));
  }, []);

  const graphData = (() => {
    if (!data?.items) return { nodes: [], links: [] };
    const nodes = [
      { id: "router", label: "Router", category: "network", status: "online", fx: 400, fy: 300 },
      ...data.items.map((d: any) => ({
        id: d.id,
        label: d.display_name || d.hostname || d.mac_address,
        category: d.category,
        status: d.status,
        ip: d.ip_address,
      })),
    ];
    const links = data.items.map((d: any) => ({ source: "router", target: d.id }));
    return { nodes, links };
  })();

  return (
    <div className="flex flex-col overflow-hidden">
      <TopBar title="Network Map" subtitle="Live topology visualization" live />
      <div className="relative flex-1 overflow-hidden">
        {ForceGraph && graphData.nodes.length > 0 ? (
          <ForceGraph
            graphData={graphData}
            nodeLabel={(n: any) => `${n.label}${n.ip ? ` (${n.ip})` : ""}`}
            nodeCanvasObject={(node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
              const size = node.id === "router" ? 18 : 12;
              const color = node.status === "online" ? "#22c55e" : node.status === "offline" ? "#71717a" : "#eab308";
              ctx.beginPath();
              ctx.arc(node.x, node.y, size / 2, 0, 2 * Math.PI);
              ctx.fillStyle = color + "30";
              ctx.fill();
              ctx.strokeStyle = color;
              ctx.lineWidth = 2 / globalScale;
              ctx.stroke();
              ctx.font = `${14 / globalScale}px monospace`;
              ctx.fillStyle = color;
              ctx.textAlign = "center";
              ctx.fillText(node.id === "router" ? "⎇" : deviceIcon(node.category), node.x, node.y + 4 / globalScale);
              ctx.font = `${9 / globalScale}px sans-serif`;
              ctx.fillStyle = "rgba(200,200,200,0.8)";
              ctx.fillText(node.label, node.x, node.y + size);
            }}
            linkColor={() => "rgba(99,102,241,0.3)"}
            linkWidth={1.5}
            backgroundColor="hsl(222,25%,7%)"
            width={typeof window !== "undefined" ? window.innerWidth - 240 : 800}
            height={typeof window !== "undefined" ? window.innerHeight - 56 : 600}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {!data ? "Loading devices…" : "No devices found. Run a network scan first."}
          </div>
        )}

        {/* Legend */}
        <div className="absolute bottom-4 left-4 rounded-lg border border-border bg-card/90 p-3 text-xs backdrop-blur">
          <p className="mb-2 font-semibold text-foreground">Legend</p>
          {[
            { color: "#22c55e", label: "Online" },
            { color: "#71717a", label: "Offline" },
            { color: "#eab308", label: "Unknown" },
          ].map((l) => (
            <div key={l.label} className="flex items-center gap-2 text-muted-foreground">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: l.color }} />
              {l.label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
