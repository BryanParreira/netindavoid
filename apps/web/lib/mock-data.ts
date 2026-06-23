// Static seed data that mirrors what the backend seed script produces.
// Used when NEXT_PUBLIC_USE_MOCK=true — no backend required.

const now = new Date();
const ago = (h: number) => new Date(now.getTime() - h * 3600_000).toISOString();
const agoMin = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();

export const MOCK_USER = {
  id: "00000000-0000-0000-0000-000000000001",
  tenant_id: "00000000-0000-0000-0000-000000000000",
  email: "admin@vex.local",
  display_name: "Admin",
  role: "admin",
  totp_enabled: false,
  is_active: true,
  last_login_at: ago(1),
};

export const MOCK_DEVICES = {
  total: 12,
  online: 9,
  offline: 3,
  new_today: 1,
  items: [
    { id: "d1", mac_address: "A4:C3:F0:11:22:33", ip_address: "192.168.1.10", hostname: "anas-macbook.local", vendor: "Apple Inc.", display_name: "Ana's MacBook Pro", category: "computer", status: "online", is_trusted: true, is_blocked: false, risk_score: 0, os_guess: "macOS 14.x", first_seen_at: ago(180*24), last_seen_at: agoMin(2), open_ports: null, tags: [] },
    { id: "d2", mac_address: "F0:1D:BC:44:55:66", ip_address: "192.168.1.11", hostname: "samsung-tv.local", vendor: "Samsung Electronics", display_name: "Living Room TV", category: "media", status: "online", is_trusted: true, is_blocked: false, risk_score: 0, os_guess: "Tizen 7.0", first_seen_at: ago(90*24), last_seen_at: agoMin(5), open_ports: null, tags: [] },
    { id: "d3", mac_address: "B8:27:EB:77:88:99", ip_address: "192.168.1.12", hostname: null, vendor: "Ring LLC", display_name: "Ring Doorbell", category: "iot", status: "online", is_trusted: true, is_blocked: false, risk_score: 5, os_guess: "Linux", first_seen_at: ago(60*24), last_seen_at: agoMin(1), open_ports: null, tags: [] },
    { id: "d4", mac_address: "3C:22:FB:AA:BB:CC", ip_address: "192.168.1.13", hostname: "bryans-iphone.local", vendor: "Apple Inc.", display_name: "Bryan's iPhone", category: "mobile", status: "online", is_trusted: true, is_blocked: false, risk_score: 0, os_guess: "iOS 17.x", first_seen_at: ago(365*24), last_seen_at: agoMin(3), open_ports: null, tags: [] },
    { id: "d5", mac_address: "20:DF:B9:DD:EE:FF", ip_address: "192.168.1.14", hostname: "nest-hub.local", vendor: "Google LLC", display_name: "Google Nest Hub", category: "iot", status: "online", is_trusted: true, is_blocked: false, risk_score: 10, os_guess: "Cast OS", first_seen_at: ago(200*24), last_seen_at: agoMin(8), open_ports: null, tags: [] },
    { id: "d6", mac_address: "74:D4:35:00:11:22", ip_address: "192.168.1.15", hostname: "office-pc.local", vendor: "Dell Inc.", display_name: "Office PC", category: "computer", status: "online", is_trusted: true, is_blocked: false, risk_score: 15, os_guess: "Windows 11", first_seen_at: ago(400*24), last_seen_at: agoMin(20), open_ports: { tcp: [{ port: 3389, state: "open", service: "ms-rdp", version: "" }] }, tags: [] },
    { id: "d7", mac_address: "DC:A6:32:33:44:55", ip_address: "192.168.1.2", hostname: "pihole.local", vendor: "Raspberry Pi Foundation", display_name: "Raspberry Pi (Pi-hole)", category: "network", status: "online", is_trusted: true, is_blocked: false, risk_score: 0, os_guess: "Raspberry Pi OS", first_seen_at: ago(500*24), last_seen_at: agoMin(0), open_ports: null, tags: [] },
    { id: "d8", mac_address: "00:11:22:33:44:55", ip_address: "192.168.1.1", hostname: "router.local", vendor: "TP-Link Technologies", display_name: "OpenWrt Router", category: "network", status: "online", is_trusted: true, is_blocked: false, risk_score: 0, os_guess: "OpenWrt 23.05", first_seen_at: ago(730*24), last_seen_at: agoMin(0), open_ports: { tcp: [{ port: 80, state: "open", service: "http", version: "" }, { port: 443, state: "open", service: "https", version: "" }] }, tags: [] },
    { id: "d9", mac_address: "18:B4:30:66:77:88", ip_address: "192.168.1.16", hostname: null, vendor: "Ecobee Inc", display_name: "Smart Thermostat", category: "iot", status: "online", is_trusted: true, is_blocked: false, risk_score: 5, os_guess: "Embedded Linux", first_seen_at: ago(120*24), last_seen_at: agoMin(15), open_ports: null, tags: [] },
    { id: "d10", mac_address: "60:45:CB:99:AA:BB", ip_address: "192.168.1.17", hostname: "xbox.local", vendor: "Microsoft Corporation", display_name: "Xbox Series X", category: "media", status: "offline", is_trusted: true, is_blocked: false, risk_score: 0, os_guess: "Xbox OS", first_seen_at: ago(300*24), last_seen_at: ago(3), open_ports: null, tags: [] },
    { id: "d11", mac_address: "B0:FC:36:CC:DD:EE", ip_address: "192.168.1.18", hostname: null, vendor: null, display_name: null, category: "unknown", status: "offline", is_trusted: false, is_blocked: false, risk_score: 45, os_guess: null, first_seen_at: ago(2), last_seen_at: ago(2), open_ports: null, tags: [] },
    { id: "d12", mac_address: "AC:2B:6E:12:34:56", ip_address: "192.168.1.50", hostname: null, vendor: "OnePlus Technology", display_name: "Guest Phone", category: "guest", status: "offline", is_trusted: false, is_blocked: false, risk_score: 0, os_guess: "Android 14", first_seen_at: ago(1), last_seen_at: ago(5), open_ports: null, tags: [] },
  ],
};

// Generates a 48h bandwidth timeseries (5-min buckets)
function generateTimeseries() {
  const points = [];
  for (let m = 48 * 60; m >= 0; m -= 5) {
    const ts = new Date(now.getTime() - m * 60_000);
    const hour = ts.getHours();
    const mult = (hour >= 9 && hour <= 22) ? 2.5 : 0.4;
    const jitter = () => 0.8 + Math.random() * 0.4;
    points.push({
      ts: ts.toISOString(),
      bytes_in: Math.floor(500_000 * mult * jitter()),
      bytes_out: Math.floor(150_000 * mult * jitter()),
    });
  }
  return points;
}

const _ts = generateTimeseries();

export const MOCK_TRAFFIC_OVERVIEW = {
  summary: {
    total_bytes_in: 3_200_000_000,
    total_bytes_out: 890_000_000,
    peak_mbps_in: 42.6,
    peak_mbps_out: 18.3,
    current_mbps_in: 12.4,
    current_mbps_out: 4.1,
  },
  top_talkers: [
    { device_id: "d1", device_name: "Ana's MacBook Pro", bytes_in: 1_200_000_000, bytes_out: 320_000_000, total_bytes: 1_520_000_000, percentage: 37.5 },
    { device_id: "d6", device_name: "Office PC", bytes_in: 780_000_000, bytes_out: 210_000_000, total_bytes: 990_000_000, percentage: 24.4 },
    { device_id: "d4", device_name: "Bryan's iPhone", bytes_in: 420_000_000, bytes_out: 95_000_000, total_bytes: 515_000_000, percentage: 12.7 },
    { device_id: "d2", device_name: "Living Room TV", bytes_in: 310_000_000, bytes_out: 12_000_000, total_bytes: 322_000_000, percentage: 7.9 },
    { device_id: "d3", device_name: "Ring Doorbell", bytes_in: 180_000_000, bytes_out: 140_000_000, total_bytes: 320_000_000, percentage: 7.9 },
  ],
  timeseries: _ts,
};

export const MOCK_ALERTS = [
  { id: "a1", title: "ET MALWARE Possible C2 Communication Detected", description: "Device 192.168.1.18 attempted outbound connection to known malware C2 server 45.33.32.156:4444.", ai_explanation: "An unknown device on your network tried to connect to a server commonly used by malware to receive commands. This often means the device is infected. Consider isolating it immediately and running a full antivirus scan.", severity: "critical", category: "intrusion", status: "open", source: "suricata", triggered_at: agoMin(12), device_id: "d11", suricata_signature: "ET MALWARE Possible Malware CnC Activity" },
  { id: "a2", title: "GPL SCAN SSH Brute Force Attempt", description: "203.0.113.42 attempted 47 SSH logins in 30 seconds against 192.168.1.15.", ai_explanation: "Someone on the internet tried many passwords against your Office PC's SSH port very rapidly. This is an automated attack. Ensure SSH is not directly exposed to the internet, or configure fail2ban to auto-block repeated failures.", severity: "high", category: "intrusion", status: "open", source: "suricata", triggered_at: agoMin(38), device_id: "d6", suricata_signature: "GPL SCAN SSH Brute Force Attempt" },
  { id: "a3", title: "DNS Lookup for Known Malicious Domain", description: "Ring Doorbell queried malicious-c2.xyz which appears in 3 threat intelligence feeds.", ai_explanation: "Your Ring Doorbell looked up a domain flagged as malicious. IoT devices sometimes do this due to outdated firmware or supply-chain issues. Check for firmware updates and consider blocking this domain in Pi-hole.", severity: "high", category: "dns", status: "open", source: "suricata", triggered_at: agoMin(65), device_id: "d3", suricata_signature: null },
  { id: "a4", title: "New Unrecognized Device Joined Network", description: "Device with MAC B0:FC:36:CC:DD:EE (unknown vendor) joined your network from IP 192.168.1.18.", ai_explanation: "A device you haven't seen before joined your Wi-Fi network. The MAC address doesn't match any known vendor, which is unusual. If you don't recognize this device, consider blocking it until you can identify it.", severity: "medium", category: "new_device", status: "open", source: "system", triggered_at: ago(2), device_id: "d11", suricata_signature: null },
  { id: "a5", title: "Unusual Outbound Traffic Spike — Office PC", description: "Office PC sent 3.2× its normal outbound traffic in the last 15 minutes (peak: 28 Mbps upload).", ai_explanation: "Your Office PC sent a lot more data than usual to external servers. This could be a scheduled backup, a large file upload, or — less likely — data being exfiltrated. Check what application was active at that time.", severity: "medium", category: "anomaly", status: "acknowledged", source: "system", triggered_at: ago(4), device_id: "d6", suricata_signature: null },
  { id: "a6", title: "ET SCAN Nmap Scripting Engine User-Agent Detected", description: "Nmap scan activity detected originating from 192.168.1.10.", ai_explanation: "A network scanning tool (nmap) was run from Ana's MacBook Pro against your local network. This may be intentional security testing or an application that does network discovery.", severity: "low", category: "intrusion", status: "resolved", source: "suricata", triggered_at: ago(8), device_id: "d1", suricata_signature: "ET SCAN Nmap Scripting Engine User-Agent" },
];

export const MOCK_ALERT_STATS = { critical: 1, high: 2, medium: 2, low: 1 };

const REMEDIATION: Record<string, string[]> = {
  intrusion: [
    "Block the source IP at your firewall immediately.",
    "Isolate the affected device from the network.",
    "Check for lateral movement — review traffic from the device over the past 24 hours.",
    "Update IDS signatures and run a full vulnerability scan on the affected host.",
    "Rotate any credentials that may have been exposed.",
  ],
  dns: [
    "The queried domain has been flagged as malicious or C2 infrastructure.",
    "Block this domain in your DNS resolver (Pi-hole or AdGuard).",
    "Investigate the device that made the query — it may be compromised.",
    "Run an antivirus / malware scan on the device.",
    "Check if other devices also queried this domain in the DNS log.",
  ],
  new_device: [
    "Verify whether this device belongs to someone in your household.",
    "If unrecognized, block it via the Devices page.",
    "Check the MAC vendor to identify the manufacturer.",
    "Enable device approval mode in Settings to require approval for new devices.",
  ],
  anomaly: [
    "Review the device's recent traffic in the Traffic page for unusual patterns.",
    "Verify the top destination IPs — look for unfamiliar countries or cloud providers.",
    "If traffic destination is unknown, block the IP and investigate further.",
    "Consider adding a custom alert rule to catch this pattern automatically.",
  ],
};

export const MOCK_ALERT_DETAIL = (id: string) => {
  const base = MOCK_ALERTS.find((a) => a.id === id);
  if (!base) return null;
  const device = MOCK_DEVICES.items.find((d) => d.id === base.device_id) ?? null;
  return {
    ...base,
    acknowledged_at: base.status === "acknowledged" ? agoMin(5) : null,
    resolved_at: base.status === "resolved" ? agoMin(30) : null,
    raw_data: base.source === "suricata" ? {
      event_type: "alert",
      src_ip: "45.33.32.156",
      src_port: 4444,
      dest_ip: "192.168.1.18",
      dest_port: 52841,
      proto: "TCP",
      alert: { signature: base.suricata_signature, category: base.category, severity: 1 },
      flow: { pkts_toserver: 3, pkts_toclient: 0, bytes_toserver: 180, bytes_toclient: 0 },
    } : null,
    affected_device: device,
    remediation_steps: REMEDIATION[base.category] ?? [],
    related_alert_count: base.device_id ? 2 : 0,
  };
};

export const MOCK_DNS_OVERVIEW = {
  total: 14_823,
  blocked: 1_204,
  malicious: 3,
  unique_domains: 892,
  block_rate: 8.1,
  top_domains: [
    { domain: "google.com", count: 1842, blocked: false },
    { domain: "youtube.com", count: 1203, blocked: false },
    { domain: "apple.com", count: 876, blocked: false },
    { domain: "netflix.com", count: 654, blocked: false },
    { domain: "ads.doubleclick.net", count: 498, blocked: true },
    { domain: "pagead2.googlesyndication.com", count: 412, blocked: true },
    { domain: "spotify.com", count: 389, blocked: false },
    { domain: "github.com", count: 334, blocked: false },
    { domain: "amazon.com", count: 287, blocked: false },
    { domain: "update.ring.amazon.com", count: 203, blocked: false },
  ],
  top_blocked: [
    { domain: "ads.doubleclick.net", count: 498 },
    { domain: "pagead2.googlesyndication.com", count: 412 },
    { domain: "tracking.google-analytics.com", count: 178 },
    { domain: "l.facebook.com", count: 116 },
    { domain: "telemetry.microsoft.com", count: 0 },
  ],
};

function generateDnsQueries() {
  const domains = [
    { d: "google.com", blocked: false }, { d: "youtube.com", blocked: false },
    { d: "apple.com", blocked: false }, { d: "ads.doubleclick.net", blocked: true },
    { d: "netflix.com", blocked: false }, { d: "spotify.com", blocked: false },
    { d: "github.com", blocked: false }, { d: "pagead2.googlesyndication.com", blocked: true },
    { d: "malicious-c2.xyz", blocked: false }, { d: "amazon.com", blocked: false },
    { d: "update.ring.amazon.com", blocked: false }, { d: "reddit.com", blocked: false },
  ];
  return Array.from({ length: 80 }, (_, i) => {
    const { d, blocked } = domains[i % domains.length];
    return {
      id: `dq${i}`,
      domain: d,
      query_type: i % 7 === 0 ? "AAAA" : "A",
      queried_at: agoMin(i * 2),
      is_blocked: blocked,
      is_malicious: d === "malicious-c2.xyz",
      response_code: blocked ? "NXDOMAIN" : "NOERROR",
      resolved_ip: blocked ? null : `142.250.${i % 255}.${(i * 3) % 255}`,
      source: i % 3 === 0 ? "pihole" : "suricata",
    };
  });
}

export const MOCK_DNS_QUERIES = generateDnsQueries();

export const MOCK_AI_RESPONSE = (question: string) => ({
  answer: `Based on your current network data, here's what I can tell you about "${question}":\n\nYou have 9 devices online right now with a current download speed of 12.4 Mbps. There are 3 open alerts — 1 critical (possible C2 communication from an unknown device at 192.168.1.18), 2 high severity (SSH brute force + malicious DNS). Your top bandwidth user is Ana's MacBook Pro at 37.5% of total traffic.\n\nFor the critical alert, I recommend immediately checking the unknown device at 192.168.1.18 — it attempted to contact a known malware command-and-control server. Consider blocking its MAC address (B0:FC:36:CC:DD:EE) in the Devices page while you investigate.`,
  model: "llama3.2 (mock)",
  latency_ms: 842,
});

export const MOCK_TOKEN_RESPONSE = {
  access_token: "mock_access_token_dev_only",
  refresh_token: "mock_refresh_token_dev_only",
  requires_totp: false,
  user_id: MOCK_USER.id,
  tenant_id: MOCK_USER.tenant_id,
  role: "admin",
  token_type: "bearer",
};
