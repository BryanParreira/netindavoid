"use client";
import { useEffect, useRef, useCallback, useState } from "react";
import { createWs, IS_MOCK } from "@/lib/api";

// Simulated per-path payload generators for mock mode
function mockPayload(path: string): unknown {
  if (path.includes("live-traffic")) {
    const hour = new Date().getHours();
    const activityMult = hour >= 9 && hour <= 22 ? 2.5 : 0.4;
    const jitter = () => 0.85 + Math.random() * 0.3;
    return {
      bytes_in:  Math.floor(300_000 * activityMult * jitter()),
      bytes_out: Math.floor( 90_000 * activityMult * jitter()),
    };
  }
  return {};
}

export function useWebSocket(
  path: string,
  onMessage: (data: unknown) => void,
  enabled = true
) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [connected, setConnected] = useState(false);

  const connect = useCallback(() => {
    if (!enabled || typeof window === "undefined") return;

    if (IS_MOCK) {
      // Emit initial payload immediately, then every 5 s
      setTimeout(() => {
        setConnected(true);
        onMessage(mockPayload(path));
      }, 300);
      tickerRef.current = setInterval(() => onMessage(mockPayload(path)), 5_000);
      return;
    }

    const ws = createWs(path);
    if (!ws) return;
    wsRef.current = ws;

    ws.onopen  = () => setConnected(true);

    ws.onmessage = (e) => {
      try { onMessage(JSON.parse(e.data)); }
      catch { onMessage(e.data); }
    };

    ws.onclose = () => {
      setConnected(false);
      reconnectTimer.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => { ws.close(); };
  }, [path, onMessage, enabled]);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (tickerRef.current) clearInterval(tickerRef.current);
    };
  }, [connect]);

  return { connected };
}
