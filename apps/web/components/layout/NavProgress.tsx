"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

export function NavProgress() {
  const pathname = usePathname();
  const [active, setActive] = useState(false);
  const prevPath = useRef(pathname);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (pathname !== prevPath.current) {
      prevPath.current = pathname;
      timer.current = setTimeout(() => setActive(false), 180);
    }
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [pathname]);

  useEffect(() => {
    const onNav = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest("a[href]") as HTMLAnchorElement | null
      if (a && a.href && !a.href.startsWith("javascript")) setActive(true)
    }
    document.addEventListener("click", onNav)
    return () => document.removeEventListener("click", onNav)
  }, [])

  return (
    <>
      <div
        aria-hidden
        style={{
          position: "fixed", top: 0, left: 0, right: 0,
          height: "2px", zIndex: 9999, pointerEvents: "none",
          opacity: active ? 1 : 0, transition: "opacity 0.2s",
        }}
      >
        <div style={{
          height: "100%",
          background: "linear-gradient(90deg, #7c3aed 0%, #a78bfa 50%, #7c3aed 100%)",
          backgroundSize: "200% 100%",
          animation: active ? "nav-shimmer 1s linear infinite" : "none",
        }} />
      </div>
      <style>{`
        @keyframes nav-shimmer {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </>
  );
}
