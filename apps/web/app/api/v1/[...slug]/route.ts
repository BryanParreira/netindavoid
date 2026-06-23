import { NextRequest, NextResponse } from "next/server";
import {
  MOCK_USER, MOCK_DEVICES, MOCK_TRAFFIC_OVERVIEW, MOCK_ALERTS,
  MOCK_ALERT_STATS, MOCK_DNS_OVERVIEW, MOCK_DNS_QUERIES,
  MOCK_AI_RESPONSE, MOCK_TOKEN_RESPONSE, MOCK_ALERT_DETAIL,
} from "@/lib/mock-data";

// Mutable device state (persists across requests in dev)
const devices = MOCK_DEVICES.items as any[];

export async function GET(
  req: NextRequest,
  { params }: { params: { slug: string[] } }
) {
  const slug = params.slug;
  const path = slug.join("/");
  const sp = req.nextUrl.searchParams;

  // ── Auth ────────────────────────────────────────────────────────────────
  if (path === "auth/me") return NextResponse.json(MOCK_USER);
  if (path === "health") return NextResponse.json({ status: "healthy (mock)", db: true, redis: true });

  // ── Devices ──────────────────────────────────────────────────────────────
  if (path === "devices") {
    const search   = sp.get("search")?.toLowerCase() ?? "";
    const category = sp.get("category") ?? "";
    const status   = sp.get("status") ?? "";
    let items = devices;
    if (search)   items = items.filter((d) =>
      [d.display_name, d.hostname, d.ip_address, d.mac_address].some((v) => v?.toLowerCase().includes(search))
    );
    if (category) items = items.filter((d) => d.category === category);
    if (status)   items = items.filter((d) => d.status === status);
    return NextResponse.json({ ...MOCK_DEVICES, items, total: items.length });
  }

  if (slug[0] === "devices" && slug[2] === "events") {
    return NextResponse.json([
      { id: "e1", type: "new",    occurred_at: new Date(Date.now() - 86400_000 * 30).toISOString(), metadata: null },
      { id: "e2", type: "online", occurred_at: new Date(Date.now() - 600_000).toISOString(),         metadata: null },
    ]);
  }

  if (slug[0] === "devices" && slug.length === 2) {
    const d = devices.find((x) => x.id === slug[1]);
    return d ? NextResponse.json(d) : NextResponse.json({ detail: "Not found" }, { status: 404 });
  }

  // ── Traffic ───────────────────────────────────────────────────────────────
  if (slug[0] === "traffic" && slug[1] === "overview") return NextResponse.json(MOCK_TRAFFIC_OVERVIEW);
  if (slug[0] === "traffic" && slug[1] === "device")   return NextResponse.json(MOCK_TRAFFIC_OVERVIEW.timeseries.slice(-48));

  // ── Alerts ────────────────────────────────────────────────────────────────
  if (path === "alerts/stats")   return NextResponse.json(MOCK_ALERT_STATS);
  if (path === "alerts/rules")   return NextResponse.json([]);

  if (slug[0] === "alerts" && slug.length === 2) {
    const detail = MOCK_ALERT_DETAIL(slug[1]);
    return detail
      ? NextResponse.json(detail)
      : NextResponse.json({ detail: "Alert not found" }, { status: 404 });
  }

  if (slug[0] === "alerts") return NextResponse.json(MOCK_ALERTS);

  // ── DNS ───────────────────────────────────────────────────────────────────
  if (slug[0] === "dns" && slug[1] === "overview") return NextResponse.json(MOCK_DNS_OVERVIEW);
  if (slug[0] === "dns" && slug[1] === "queries")  return NextResponse.json(MOCK_DNS_QUERIES);

  // ── Scans ─────────────────────────────────────────────────────────────────
  if (path === "scans") return NextResponse.json([
    { id: "s1", scan_type: "arp", status: "completed", started_at: new Date(Date.now() - 120_000).toISOString(), completed_at: new Date(Date.now() - 90_000).toISOString(), devices_found: 12, new_devices: 1 },
  ]);

  // ── WiFi ──────────────────────────────────────────────────────────────────
  if (slug[0] === "wifi") return NextResponse.json({ aps: MOCK_WIFI_APS, scan_id: null });

  // ── Uptime monitors ───────────────────────────────────────────────────────
  if (path === "uptime/monitors") return NextResponse.json(buildMonitors());
  if (slug[0] === "uptime" && slug[1] === "monitors" && slug.length === 3)
    return NextResponse.json(buildMonitors().find((m) => m.id === slug[2]) ?? null);

  // ── Network flows ─────────────────────────────────────────────────────────
  if (path === "flows" || slug[0] === "flows") return NextResponse.json(buildFlows());

  return NextResponse.json({ detail: "Not found" }, { status: 404 });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { slug: string[] } }
) {
  const slug = params.slug;
  const path = slug.join("/");

  // ── Auth ────────────────────────────────────────────────────────────────
  if (path === "auth/login" || path === "auth/register" || path === "auth/refresh") {
    return NextResponse.json(MOCK_TOKEN_RESPONSE, { status: path === "auth/register" ? 201 : 200 });
  }
  if (path === "auth/totp/setup") {
    return NextResponse.json({ secret: "JBSWY3DPEHPK3PXP", qr_code_base64: "", uri: "otpauth://totp/Vex:admin@vex.local?secret=JBSWY3DPEHPK3PXP" });
  }
  if (path === "auth/totp/verify") return NextResponse.json({ enabled: true, backup_codes: ["A1B2", "C3D4", "E5F6", "G7H8"] });
  if (path === "auth/change-password") return new NextResponse(null, { status: 204 });

  // ── Devices ──────────────────────────────────────────────────────────────
  if (slug[0] === "devices" && slug[2] === "block") {
    const d = devices.find((x) => x.id === slug[1]);
    if (!d) return NextResponse.json({ detail: "Not found" }, { status: 404 });
    const body = await req.json().catch(() => ({}));
    d.is_blocked = body.blocked;
    return NextResponse.json(d);
  }

  // ── Alerts ────────────────────────────────────────────────────────────────
  if (slug[0] === "alerts" && (slug[2] === "acknowledge" || slug[2] === "resolve")) {
    return new NextResponse(null, { status: 204 });
  }
  if (path === "alerts/rules") return NextResponse.json({}, { status: 201 });

  // ── Scans ─────────────────────────────────────────────────────────────────
  if (slug[0] === "scans") return NextResponse.json({ scan_id: "s1", task_id: "t1", status: "queued" }, { status: 202 });

  // ── AI ────────────────────────────────────────────────────────────────────
  if (path === "ai/query") {
    const body = await req.json().catch(() => ({}));
    return NextResponse.json(MOCK_AI_RESPONSE(body.question ?? ""));
  }

  // ── WiFi ──────────────────────────────────────────────────────────────────
  if (slug[0] === "wifi") {
    return NextResponse.json({ aps: MOCK_WIFI_APS, scan_id: "ws1", status: "queued" });
  }

  // ── Audit ─────────────────────────────────────────────────────────────────
  if (slug[0] === "audit") {
    return NextResponse.json({
      target: "",
      status: "completed",
      findings: MOCK_AUDIT_FINDINGS,
      started_at: new Date(Date.now() - 8_000).toISOString(),
      completed_at: new Date().toISOString(),
    });
  }

  // ── Vuln scan ─────────────────────────────────────────────────────────────
  if (slug[0] === "vulnscan") {
    return NextResponse.json({ results: [], status: "completed" });
  }

  return NextResponse.json({ detail: "Not found" }, { status: 404 });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { slug: string[] } }
) {
  const slug = params.slug;
  if (slug[0] === "devices" && slug.length === 2) {
    const d = devices.find((x) => x.id === slug[1]);
    if (!d) return NextResponse.json({ detail: "Not found" }, { status: 404 });
    const body = await req.json().catch(() => ({}));
    Object.assign(d, body);
    return NextResponse.json(d);
  }
  return NextResponse.json({ detail: "Not found" }, { status: 404 });
}

// ── Mock WiFi AP data ─────────────────────────────────────────────────────────

const MOCK_WIFI_APS = [
  {
    ssid: "HomeNetwork-5G",
    bssid: "AA:BB:CC:DD:EE:01",
    channel: 36,
    band: "5GHz",
    rssi: -45,
    security: "WPA3",
    vendor: "TP-Link",
    is_rogue: false,
    clients: 9,
    is_hidden: false,
  },
  {
    ssid: "HomeNetwork-2G",
    bssid: "AA:BB:CC:DD:EE:02",
    channel: 6,
    band: "2.4GHz",
    rssi: -52,
    security: "WPA2",
    vendor: "TP-Link",
    is_rogue: false,
    clients: 3,
    is_hidden: false,
  },
  {
    ssid: "Neighbor-WiFi",
    bssid: "11:22:33:44:55:01",
    channel: 11,
    band: "2.4GHz",
    rssi: -78,
    security: "WPA2",
    vendor: "Netgear",
    is_rogue: false,
    clients: 0,
    is_hidden: false,
  },
  {
    ssid: "(hidden)",
    bssid: "DE:AD:BE:EF:00:01",
    channel: 1,
    band: "2.4GHz",
    rssi: -82,
    security: "Open",
    vendor: null,
    is_rogue: true,
    clients: 0,
    is_hidden: true,
  },
];

// ── Mock audit findings ───────────────────────────────────────────────────────

const MOCK_AUDIT_FINDINGS = [
  { severity: "medium", title: "SSH password authentication enabled", description: "Password-based SSH login is enabled. Use key-based auth only.", port: 22, recommendation: "Disable PasswordAuthentication in sshd_config." },
  { severity: "low", title: "HTTP redirects to HTTPS", description: "Port 80 is open but correctly redirects to HTTPS.", port: 80, recommendation: "Consider disabling port 80 entirely and using HSTS preloading." },
  { severity: "info", title: "OpenSSH 8.9p1 detected", description: "SSH version is current and not known-vulnerable.", port: 22, recommendation: null },
];

// ── Uptime monitor builder ────────────────────────────────────────────────────

function makeHeartbeat(uptimePct: number) {
  return Array.from({ length: 90 }, (_, i) => {
    const ts = new Date(Date.now() - (89 - i) * 60_000).toISOString();
    const up = Math.random() * 100 < uptimePct;
    return { ts, up, ms: up ? Math.floor(1 + Math.random() * 40) : null };
  });
}

function buildMonitors() {
  return [
    { id: "m1", name: "OpenWrt Router",       type: "ping", target: "192.168.1.1",               status: "up",   uptime: 99.98, avg_ms:  2, heartbeat: makeHeartbeat(99.98), category: "network"  },
    { id: "m2", name: "Pi-hole DNS",           type: "port", target: "192.168.1.2:53",            status: "up",   uptime: 99.72, avg_ms:  8, heartbeat: makeHeartbeat(99.72), category: "network"  },
    { id: "m3", name: "Pi-hole Admin UI",      type: "http", target: "http://192.168.1.2/admin",  status: "up",   uptime: 98.61, avg_ms: 14, heartbeat: makeHeartbeat(98.61), category: "network"  },
    { id: "m4", name: "Ana's MacBook Pro",     type: "ping", target: "192.168.1.10",              status: "up",   uptime: 94.20, avg_ms:  4, heartbeat: makeHeartbeat(94.20), category: "computer" },
    { id: "m5", name: "Office PC (RDP)",       type: "port", target: "192.168.1.15:3389",         status: "up",   uptime: 87.33, avg_ms: 18, heartbeat: makeHeartbeat(87.33), category: "computer" },
    { id: "m6", name: "Ring Doorbell",         type: "ping", target: "192.168.1.12",              status: "up",   uptime: 99.10, avg_ms:  6, heartbeat: makeHeartbeat(99.10), category: "iot"      },
    { id: "m7", name: "Google Nest Hub",       type: "ping", target: "192.168.1.14",              status: "up",   uptime: 97.50, avg_ms:  5, heartbeat: makeHeartbeat(97.50), category: "iot"      },
    { id: "m8", name: "Smart Thermostat",      type: "ping", target: "192.168.1.16",              status: "up",   uptime: 99.90, avg_ms:  3, heartbeat: makeHeartbeat(99.90), category: "iot"      },
    { id: "m9", name: "Living Room TV",        type: "ping", target: "192.168.1.11",              status: "up",   uptime: 91.40, avg_ms: 11, heartbeat: makeHeartbeat(91.40), category: "media"    },
    { id: "m10", name: "Xbox Series X",        type: "ping", target: "192.168.1.17",              status: "down", uptime: 62.10, avg_ms: null, heartbeat: makeHeartbeat(62.10), category: "media"  },
    { id: "m11", name: "Bryan's iPhone",       type: "ping", target: "192.168.1.13",              status: "up",   uptime: 96.80, avg_ms:  7, heartbeat: makeHeartbeat(96.80), category: "mobile"  },
    { id: "m12", name: "Internet (8.8.8.8)",   type: "ping", target: "8.8.8.8",                   status: "up",   uptime: 99.95, avg_ms: 18, heartbeat: makeHeartbeat(99.95), category: "external" },
    { id: "m13", name: "Cloudflare DNS",       type: "ping", target: "1.1.1.1",                   status: "up",   uptime: 99.99, avg_ms: 12, heartbeat: makeHeartbeat(99.99), category: "external" },
  ];
}

// ── Network flow builder ──────────────────────────────────────────────────────

const FLOW_SEEDS = [
  { src: "192.168.1.10", dst: "142.250.80.46",  dst_port: 443,  proto: "TCP", app: "TLS/HTTPS",  bytes:  2_450_000, pkts: 1820, dur: 3600, country: "US", asn: "Google LLC",        device: "Ana's MacBook Pro",         risk: null        },
  { src: "192.168.1.10", dst: "17.253.144.10",  dst_port: 443,  proto: "TCP", app: "TLS/HTTPS",  bytes:    890_000, pkts:  610, dur: 1200, country: "US", asn: "Apple Inc.",         device: "Ana's MacBook Pro",         risk: null        },
  { src: "192.168.1.15", dst: "52.96.0.12",     dst_port: 443,  proto: "TCP", app: "TLS/HTTPS",  bytes:  1_200_000, pkts:  980, dur: 5400, country: "US", asn: "Microsoft Corp.",    device: "Office PC",                 risk: null        },
  { src: "192.168.1.15", dst: "203.0.113.42",   dst_port:  22,  proto: "TCP", app: "SSH",        bytes:     42_000, pkts:  450, dur:   62, country: "CN", asn: "Unknown AS",         device: "Office PC",                 risk: "brute_force" },
  { src: "192.168.1.18", dst: "45.33.32.156",   dst_port: 4444, proto: "TCP", app: "UNKNOWN",    bytes:      8_200, pkts:   38, dur:   15, country: "US", asn: "Linode LLC",         device: "Unknown Device",            risk: "c2_comms"  },
  { src: "192.168.1.12", dst: "52.35.12.18",    dst_port: 443,  proto: "TCP", app: "TLS/HTTPS",  bytes:    310_000, pkts:  240, dur: 1800, country: "US", asn: "Amazon.com Inc.",    device: "Ring Doorbell",             risk: null        },
  { src: "192.168.1.13", dst: "31.13.72.36",    dst_port: 443,  proto: "TCP", app: "TLS/HTTPS",  bytes:    520_000, pkts:  380, dur: 2100, country: "IE", asn: "Meta Platforms",     device: "Bryan's iPhone",            risk: null        },
  { src: "192.168.1.11", dst: "108.175.34.10",  dst_port: 443,  proto: "TCP", app: "TLS/HTTPS",  bytes:  3_800_000, pkts: 2900, dur: 7200, country: "US", asn: "Netflix Inc.",       device: "Living Room TV",            risk: null        },
  { src: "192.168.1.2",  dst: "8.8.8.8",        dst_port:  53,  proto: "UDP", app: "DNS",        bytes:     14_400, pkts: 1200, dur: 3600, country: "US", asn: "Google LLC",         device: "Pi-hole",                   risk: null        },
  { src: "192.168.1.14", dst: "216.239.36.1",   dst_port: 443,  proto: "TCP", app: "TLS/HTTPS",  bytes:     98_000, pkts:  112, dur:  900, country: "US", asn: "Google LLC",         device: "Google Nest Hub",           risk: null        },
  { src: "192.168.1.10", dst: "140.82.113.4",   dst_port: 443,  proto: "TCP", app: "TLS/HTTPS",  bytes:    430_000, pkts:  320, dur: 1500, country: "US", asn: "GitHub Inc.",        device: "Ana's MacBook Pro",         risk: null        },
  { src: "192.168.1.16", dst: "54.239.26.214",  dst_port: 443,  proto: "TCP", app: "TLS/HTTPS",  bytes:     22_000, pkts:   55, dur:  600, country: "US", asn: "Amazon.com Inc.",    device: "Smart Thermostat",          risk: null        },
];

let _flowSeed = 0;
function buildFlows() {
  _flowSeed++;
  return FLOW_SEEDS.map((f, i) => ({
    id: `fl-${i}`,
    src_ip: f.src,
    src_port: 40000 + (i * 1337 + _flowSeed * 7) % 20000,
    dst_ip: f.dst,
    dst_port: f.dst_port,
    proto: f.proto,
    app_proto: f.app,
    bytes_toserver: Math.floor(f.bytes * 0.35 * (0.9 + Math.random() * 0.2)),
    bytes_toclient: Math.floor(f.bytes * 0.65 * (0.9 + Math.random() * 0.2)),
    pkts_toserver: Math.floor(f.pkts * 0.4),
    pkts_toclient: Math.floor(f.pkts * 0.6),
    duration_s: f.dur,
    country: f.country,
    asn: f.asn,
    device_name: f.device,
    state: i === 9 ? "closed" : "established",
    risk: f.risk,
    started_at: new Date(Date.now() - f.dur * 1000).toISOString(),
  }));
}
