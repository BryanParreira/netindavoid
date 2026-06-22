import { cn } from "@/lib/utils";
import {
  Monitor, Smartphone, Cpu, Network, Tv2, UserCircle2, CircleHelp,
  Printer, Gamepad2, Camera, Server, Tablet, Wifi,
} from "lucide-react";

const MAP: Record<string, { Icon: React.ElementType; bg: string; text: string }> = {
  computer: { Icon: Monitor,       bg: "bg-blue-500/15",    text: "text-blue-400" },
  mobile:   { Icon: Smartphone,    bg: "bg-emerald-500/15", text: "text-emerald-400" },
  iot:      { Icon: Cpu,           bg: "bg-violet-500/15",  text: "text-violet-400" },
  network:  { Icon: Network,       bg: "bg-brand-500/15",   text: "text-brand-400" },
  media:    { Icon: Tv2,           bg: "bg-pink-500/15",    text: "text-pink-400" },
  guest:    { Icon: UserCircle2,   bg: "bg-zinc-500/15",    text: "text-zinc-400" },
  printer:  { Icon: Printer,       bg: "bg-amber-500/15",   text: "text-amber-400" },
  gaming:   { Icon: Gamepad2,      bg: "bg-green-500/15",   text: "text-green-400" },
  camera:   { Icon: Camera,        bg: "bg-red-500/15",     text: "text-red-400" },
  server:   { Icon: Server,        bg: "bg-cyan-500/15",    text: "text-cyan-400" },
  tablet:   { Icon: Tablet,        bg: "bg-sky-500/15",     text: "text-sky-400" },
  unknown:  { Icon: CircleHelp,    bg: "bg-muted",          text: "text-muted-foreground" },
};

interface DeviceIconProps {
  category: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const SIZE = {
  sm: { wrap: "h-6 w-6 rounded", icon: "h-3 w-3" },
  md: { wrap: "h-8 w-8 rounded-lg", icon: "h-4 w-4" },
  lg: { wrap: "h-10 w-10 rounded-xl", icon: "h-5 w-5" },
};

export function DeviceIcon({ category, size = "md", className }: DeviceIconProps) {
  const cfg = MAP[category] ?? MAP.unknown;
  const s   = SIZE[size];
  return (
    <span className={cn("flex shrink-0 items-center justify-center", s.wrap, cfg.bg, className)}>
      <cfg.Icon className={cn(s.icon, cfg.text)} strokeWidth={1.75} />
    </span>
  );
}
