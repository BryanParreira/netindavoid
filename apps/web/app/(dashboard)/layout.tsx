"use client";
import { useAlertsStore } from "@/store/alerts";
import { useWebSocket } from "@/hooks/useWebSocket";
import { Sidebar } from "@/components/layout/Sidebar";
import toast from "react-hot-toast";

function AlertWatcher() {
  const pushAlert = useAlertsStore((s) => s.pushAlert);

  useWebSocket("/ws/alerts", (data: unknown) => {
    const msg = data as { event: string; severity: string; title: string; alert_id: string };
    if (msg.event === "new_alert") {
      pushAlert({
        id: msg.alert_id,
        title: msg.title,
        severity: msg.severity,
        triggered_at: new Date().toISOString(),
        status: "open",
        category: "intrusion",
      });
      const colors: Record<string, string> = { critical: "🔴", high: "🟠", medium: "🟡", low: "🟢" };
      toast(`${colors[msg.severity] ?? "⚪"} ${msg.title}`, { duration: 5000 });
    }
  });

  return null;
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <AlertWatcher />
      <main className="flex flex-1 flex-col overflow-hidden">
        {children}
      </main>
    </div>
  );
}
