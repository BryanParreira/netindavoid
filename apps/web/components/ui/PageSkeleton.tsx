"use client";

function Bone({ className = "", style = {} }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={className}
      style={{
        background: "linear-gradient(90deg, hsl(0 0% 13%) 25%, hsl(0 0% 17%) 50%, hsl(0 0% 13%) 75%)",
        backgroundSize: "200% 100%",
        animation: "sk-shimmer 1.4s ease-in-out infinite",
        borderRadius: "4px",
        ...style,
      }}
    />
  );
}

export function PageSkeleton() {
  return (
    <>
      <style>{`
        @keyframes sk-shimmer {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>

      <div className="flex flex-col h-full p-6 gap-6" style={{ background: "hsl(var(--background))" }}>
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-2">
            <Bone style={{ width: 180, height: 22 }} />
            <Bone style={{ width: 280, height: 13 }} />
          </div>
          <div className="flex gap-2">
            <Bone style={{ width: 88, height: 32, borderRadius: "6px" }} />
            <Bone style={{ width: 88, height: 32, borderRadius: "6px" }} />
          </div>
        </div>

        {/* Stat cards row */}
        <div className="grid grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="rounded-lg p-4 flex flex-col gap-3"
                 style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
              <div className="flex items-center justify-between">
                <Bone style={{ width: 80, height: 11 }} />
                <Bone style={{ width: 28, height: 28, borderRadius: "6px" }} />
              </div>
              <Bone style={{ width: 100, height: 28 }} />
              <Bone style={{ width: 120, height: 11 }} />
            </div>
          ))}
        </div>

        {/* Main content area */}
        <div className="flex gap-4 flex-1 min-h-0">
          {/* Table skeleton */}
          <div className="flex-1 rounded-lg overflow-hidden"
               style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
            {/* Table header */}
            <div className="flex gap-4 px-4 py-3" style={{ borderBottom: "1px solid hsl(var(--border))" }}>
              {[120, 90, 140, 80, 60].map((w, i) => (
                <Bone key={i} style={{ width: w, height: 11 }} />
              ))}
            </div>
            {/* Table rows */}
            {[...Array(8)].map((_, i) => (
              <div key={i} className="flex gap-4 px-4 py-3 items-center"
                   style={{ borderBottom: "1px solid hsl(var(--border) / 0.5)", opacity: 1 - i * 0.07 }}>
                <Bone style={{ width: 28, height: 28, borderRadius: "50%" }} />
                <Bone style={{ width: 120, height: 13 }} />
                <Bone style={{ width: 90, height: 11 }} />
                <Bone style={{ width: 140, height: 11 }} />
                <Bone style={{ width: 60, height: 20, borderRadius: "999px" }} />
                <Bone style={{ width: 50, height: 11 }} />
              </div>
            ))}
          </div>

          {/* Right panel skeleton */}
          <div className="w-64 rounded-lg flex flex-col gap-4 p-4 shrink-0"
               style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
            <Bone style={{ width: 100, height: 13 }} />
            <Bone style={{ width: "100%", height: 120, borderRadius: "8px" }} />
            <Bone style={{ width: 120, height: 13 }} />
            {[...Array(4)].map((_, i) => (
              <div key={i} className="flex items-center justify-between">
                <Bone style={{ width: 80, height: 11 }} />
                <Bone style={{ width: 50, height: 11 }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

// Minimal inline skeleton for smaller sections
export function CardSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="rounded-lg p-4 flex flex-col gap-3"
         style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
      <style>{`@keyframes sk-shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>
      {[...Array(rows)].map((_, i) => (
        <Bone key={i} style={{ width: `${60 + (i % 3) * 15}%`, height: 13 }} />
      ))}
    </div>
  );
}
