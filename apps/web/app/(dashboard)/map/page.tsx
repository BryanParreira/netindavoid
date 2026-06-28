"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import useSWR from "swr";
import { api } from "@/lib/api";
import { TopBar } from "@/components/layout/TopBar";
import { deviceIcon } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { ZoomIn, ZoomOut, Maximize2, RefreshCw } from "lucide-react";

const fetcher = (url: string) => api.get(url).then((r) => r.data);

const CATEGORY_COLOR: Record<string, string> = {
  network:  "#8b5cf6",
  computer: "#22d3ee",
  mobile:   "#34d399",
  iot:      "#f59e0b",
  media:    "#f97316",
  external: "#6b7280",
};

export default function MapPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims]         = useState({ w: 800, h: 600 });
  const [ForceGraph, setFG]     = useState<any>(null);
  const [selected, setSelected] = useState<any>(null);
  const fgRef = useRef<any>(null);

  const { data, mutate } = useSWR("/devices?limit=200", fetcher, { refreshInterval: 15_000 });
  const { data: networkInfo } = useSWR("/network/current", fetcher, { refreshInterval: 60_000 });

  // Responsive sizing
  useEffect(() => {
    const obs = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setDims({ w: Math.floor(width), h: Math.floor(height) });
    });
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    import("react-force-graph-2d").then(m => setFG(() => m.default));
  }, []);

  const graphData = (() => {
    if (!data?.items?.length) return { nodes: [], links: [] };
    const gatewayIp = networkInfo?.network?.gateway_ip ?? networkInfo?.gateway ?? "Gateway";
    const router = {
      id: "__router__", label: "Router / Gateway",
      category: "network", status: "online", ip: gatewayIp,
      isRouter: true, fx: dims.w / 2, fy: dims.h / 2,
    };
    const nodes = [router, ...data.items.map((d: any) => ({
      id: d.id,
      label: d.display_name || d.hostname || d.mac_address,
      category: d.category ?? "external",
      status: d.status,
      ip: d.ip_address,
      mac: d.mac_address,
      vendor: d.vendor,
      isRouter: false,
    }))];
    const links = data.items.map((d: any) => ({
      source: "__router__", target: d.id,
      color: d.status === "online" ? "rgba(139,92,246,0.25)" : "rgba(100,100,100,0.12)",
    }));
    return { nodes, links };
  })();

  const drawNode = useCallback((node: any, ctx: CanvasRenderingContext2D, gs: number) => {
    const isRouter = node.isRouter;
    const r = isRouter ? 22 : 14;
    const color = isRouter ? "#8b5cf6" : (CATEGORY_COLOR[node.category] ?? "#6b7280");
    const isOnline = node.status === "online";
    const isSelected = selected?.id === node.id;

    // Glow ring for selected
    if (isSelected) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + 6 / gs, 0, 2 * Math.PI);
      ctx.strokeStyle = color + "88";
      ctx.lineWidth = 3 / gs;
      ctx.stroke();
    }

    // Outer ring (pulse for online)
    ctx.beginPath();
    ctx.arc(node.x, node.y, r / gs * gs, 0, 2 * Math.PI);
    ctx.fillStyle = color + (isOnline ? "22" : "0a");
    ctx.fill();
    ctx.strokeStyle = color + (isOnline ? "cc" : "44");
    ctx.lineWidth = (isRouter ? 2.5 : 1.5) / gs;
    ctx.stroke();

    // Icon
    ctx.font = `${(isRouter ? 13 : 10) / gs}px monospace`;
    ctx.fillStyle = isOnline ? color : color + "55";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(deviceIcon(node.category), node.x, node.y);

    // Label
    const labelSize = (isRouter ? 10 : 8) / gs;
    ctx.font = `${labelSize}px -apple-system, sans-serif`;
    ctx.fillStyle = isOnline ? "rgba(237,237,237,0.9)" : "rgba(120,120,120,0.6)";
    ctx.textBaseline = "top";
    const label = node.label?.length > 18 ? node.label.slice(0, 16) + "…" : node.label;
    ctx.fillText(label, node.x, node.y + r / gs * gs + 4 / gs);

    // IP
    if (node.ip && gs > 0.8) {
      ctx.font = `${7 / gs}px monospace`;
      ctx.fillStyle = "rgba(140,140,140,0.6)";
      ctx.fillText(node.ip, node.x, node.y + r / gs * gs + labelSize + 6 / gs);
    }
  }, [selected]);

  const online  = data?.items?.filter((d: any) => d.status === "online").length ?? 0;
  const total   = data?.total ?? 0;

  return (
    <div className="flex flex-col overflow-hidden h-full">
      <TopBar
        title="Network Map"
        subtitle={`${online} online · ${total} total devices`}
        live
        actions={
          <button onClick={() => mutate()}
            className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
        }
      />

      <div className="relative flex-1 overflow-hidden" ref={containerRef}>
        {ForceGraph && graphData.nodes.length > 0 ? (
          <ForceGraph
            ref={fgRef}
            graphData={graphData}
            width={dims.w}
            height={dims.h}
            backgroundColor="#111111"
            nodeCanvasObject={drawNode}
            nodePointerAreaPaint={(node: any, color: string, ctx: CanvasRenderingContext2D) => {
              ctx.beginPath();
              ctx.arc(node.x, node.y, (node.isRouter ? 22 : 14), 0, 2 * Math.PI);
              ctx.fillStyle = color;
              ctx.fill();
            }}
            linkColor={(link: any) => link.color ?? "rgba(139,92,246,0.2)"}
            linkWidth={1}
            linkCurvature={0.1}
            onNodeClick={(node: any) => setSelected(selected?.id === node.id ? null : node)}
            nodeLabel={() => ""}
            cooldownTicks={120}
            d3AlphaDecay={0.02}
            d3VelocityDecay={0.3}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted-foreground">
              {!data ? "Loading…" : "No devices found. Run a scan first."}
            </p>
          </div>
        )}

        {/* Controls */}
        <div className="absolute right-4 top-4 flex flex-col gap-1.5">
          {[
            { icon: ZoomIn,     tip: "Zoom in",   act: () => fgRef.current?.zoom(fgRef.current.zoom() * 1.3) },
            { icon: ZoomOut,    tip: "Zoom out",  act: () => fgRef.current?.zoom(fgRef.current.zoom() * 0.7) },
            { icon: Maximize2,  tip: "Fit",       act: () => fgRef.current?.zoomToFit(400) },
          ].map(({ icon: Icon, tip, act }) => (
            <button key={tip} onClick={act} title={tip}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card/90 text-muted-foreground backdrop-blur hover:text-foreground hover:bg-accent transition-colors">
              <Icon className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>

        {/* Legend */}
        <div className="absolute bottom-4 left-4 rounded-xl border border-border bg-card/90 p-3 backdrop-blur text-xs space-y-1.5">
          <p className="font-semibold text-foreground mb-2">Device Types</p>
          {Object.entries(CATEGORY_COLOR).map(([cat, color]) => (
            <div key={cat} className="flex items-center gap-2 text-muted-foreground capitalize">
              <span className="h-2 w-2 rounded-full" style={{ background: color }} />
              {cat}
            </div>
          ))}
        </div>

        {/* Selected device panel */}
        {selected && !selected.isRouter && (
          <div className="absolute right-4 bottom-4 w-56 rounded-xl border border-border bg-card/95 p-4 backdrop-blur space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-foreground truncate">{selected.label}</p>
              <button onClick={() => setSelected(null)} className="text-muted-foreground hover:text-foreground text-xs">✕</button>
            </div>
            <div className="space-y-1 text-[11px]">
              {[
                ["IP",       selected.ip],
                ["MAC",      selected.mac],
                ["Category", selected.category],
                ["Vendor",   selected.vendor],
                ["Status",   selected.status],
              ].filter(([, v]) => v).map(([k, v]) => (
                <div key={k as string} className="flex justify-between gap-2">
                  <span className="text-muted-foreground shrink-0">{k}</span>
                  <span className={cn("font-mono text-foreground truncate",
                    k === "Status" && selected.status === "online" && "text-emerald-400",
                    k === "Status" && selected.status !== "online" && "text-muted-foreground"
                  )}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
