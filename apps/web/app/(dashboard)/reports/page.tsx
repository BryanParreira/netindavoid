"use client";
import { TopBar } from "@/components/layout/TopBar";
import { BarChart2, Download } from "lucide-react";

export default function ReportsPage() {
  return (
    <div className="flex flex-col overflow-hidden">
      <TopBar title="Reports" subtitle="Historical analytics and exports" />
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="text-center">
          <BarChart2 className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Reports — Phase 4</h2>
          <p className="mt-2 max-w-sm text-xs text-muted-foreground">
            Historical analytics with time-range queries, PDF/CSV export, and scheduled reports are coming in Phase 4.
          </p>
        </div>
      </div>
    </div>
  );
}
