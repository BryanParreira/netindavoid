"""Security audit service — SSL, HTTP headers, banner grab, port vulns, DNS security."""
import socket
import ssl
import subprocess
import re
import json
from datetime import datetime, timezone
from typing import Any

import structlog

logger = structlog.get_logger()


# ── SSL / TLS ────────────────────────────────────────────────────────────────

def ssl_check(ip: str, port: int = 443, hostname: str | None = None) -> dict[str, Any]:
    """Check SSL certificate and TLS configuration on a host:port."""
    sni = hostname or ip
    result: dict[str, Any] = {
        "port": port,
        "hostname": sni,
        "ok": False,
        "error": None,
    }
    try:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_OPTIONAL

        with socket.create_connection((ip, port), timeout=5) as sock:
            with ctx.wrap_socket(sock, server_hostname=sni) as ssock:
                cert = ssock.getpeercert()
                cipher = ssock.cipher()
                version = ssock.version()

                # Expiry
                not_after_str = cert.get("notAfter", "")
                expiry = None
                days_left = None
                if not_after_str:
                    expiry = datetime.strptime(not_after_str, "%b %d %H:%M:%S %Y %Z").replace(tzinfo=timezone.utc)
                    days_left = (expiry - datetime.now(timezone.utc)).days

                # SANs
                sans = [v for t, v in cert.get("subjectAltName", []) if t == "DNS"]

                # Subject CN
                subject = dict(x[0] for x in cert.get("subject", []))
                cn = subject.get("commonName", "")

                # Issuer
                issuer = dict(x[0] for x in cert.get("issuer", []))

                # Weak checks
                weak_cipher = cipher[0] in {"RC4", "DES", "3DES", "NULL", "EXPORT", "anon"} if cipher else False
                weak_protocol = version in {"SSLv2", "SSLv3", "TLSv1", "TLSv1.1"}

                result.update({
                    "ok": True,
                    "tls_version": version,
                    "cipher": cipher[0] if cipher else None,
                    "cipher_bits": cipher[2] if cipher and len(cipher) > 2 else None,
                    "common_name": cn,
                    "issuer_org": issuer.get("organizationName", issuer.get("commonName", "")),
                    "sans": sans,
                    "not_after": expiry.isoformat() if expiry else None,
                    "days_until_expiry": days_left,
                    "expired": (days_left is not None and days_left < 0),
                    "expiring_soon": (days_left is not None and 0 <= days_left <= 30),
                    "weak_cipher": weak_cipher,
                    "weak_protocol": weak_protocol,
                    "self_signed": issuer == subject,
                })

    except ssl.SSLError as e:
        result["error"] = f"SSL error: {e.reason or str(e)}"
    except ConnectionRefusedError:
        result["error"] = f"Port {port} closed"
    except socket.timeout:
        result["error"] = f"Connection to {ip}:{port} timed out"
    except OSError as e:
        result["error"] = str(e)

    return result


# ── HTTP Security Headers ─────────────────────────────────────────────────────

def http_security_check(ip: str, port: int = 80, use_https: bool = False,
                        path: str = "/", hostname: str | None = None) -> dict[str, Any]:
    """Fetch HTTP response and evaluate security headers."""
    import urllib.request
    import urllib.error

    scheme = "https" if use_https else "http"
    host_header = hostname or ip
    url = f"{scheme}://{ip}:{port}{path}"

    result: dict[str, Any] = {
        "url": url,
        "ok": False,
        "status_code": None,
        "server": None,
        "headers": {},
        "missing_headers": [],
        "issues": [],
    }

    SECURITY_HEADERS = [
        "strict-transport-security",
        "x-frame-options",
        "x-content-type-options",
        "content-security-policy",
        "x-xss-protection",
        "referrer-policy",
        "permissions-policy",
    ]

    try:
        req = urllib.request.Request(url, headers={"Host": host_header, "User-Agent": "VexAudit/1.0"})
        ctx = ssl.create_default_context() if use_https else None
        if ctx:
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
        resp = urllib.request.urlopen(req, timeout=5, context=ctx)
        headers = {k.lower(): v for k, v in resp.headers.items()}

        result["ok"] = True
        result["status_code"] = resp.status
        result["server"] = headers.get("server", "")
        result["headers"] = {k: headers[k] for k in SECURITY_HEADERS if k in headers}
        result["missing_headers"] = [k for k in SECURITY_HEADERS if k not in headers]

        # Flag leaky server header
        if result["server"]:
            result["issues"].append(f"Server header reveals software: {result['server']}")

        # Flag missing critical headers
        if "strict-transport-security" not in headers and use_https:
            result["issues"].append("HSTS missing — susceptible to SSL stripping")
        if "x-frame-options" not in headers:
            result["issues"].append("X-Frame-Options missing — clickjacking possible")
        if "content-security-policy" not in headers:
            result["issues"].append("CSP missing — XSS risk")

    except urllib.error.URLError as e:
        result["error"] = str(e.reason)
    except Exception as e:
        result["error"] = str(e)

    return result


# ── Banner Grab ───────────────────────────────────────────────────────────────

def grab_banner(ip: str, port: int, timeout: float = 3.0) -> str | None:
    """Grab raw service banner from a TCP port."""
    try:
        with socket.create_connection((ip, port), timeout=timeout) as s:
            # Some services send banner immediately
            s.settimeout(timeout)
            try:
                banner = s.recv(1024)
                return banner.decode("utf-8", errors="replace").strip()
            except socket.timeout:
                # Send a probe and wait
                s.send(b"HEAD / HTTP/1.0\r\n\r\n")
                try:
                    banner = s.recv(1024)
                    return banner.decode("utf-8", errors="replace").strip()
                except Exception:
                    return None
    except Exception:
        return None


# ── Port Vulnerability Mapping ───────────────────────────────────────────────

_PORT_VULNS: dict[int, dict] = {
    21:    {"service": "FTP",      "severity": "high",     "risk": "Cleartext credentials, anonymous access risk"},
    22:    {"service": "SSH",      "severity": "medium",   "risk": "Brute-force target; check key-only auth and disable root login"},
    23:    {"service": "Telnet",   "severity": "critical", "risk": "Cleartext protocol — credentials sent in plain text"},
    25:    {"service": "SMTP",     "severity": "medium",   "risk": "Open relay or spam source if misconfigured"},
    53:    {"service": "DNS",      "severity": "medium",   "risk": "DNS amplification DDoS if open resolver"},
    80:    {"service": "HTTP",     "severity": "low",      "risk": "Check for security headers and redirect to HTTPS"},
    110:   {"service": "POP3",     "severity": "medium",   "risk": "Cleartext mail retrieval"},
    143:   {"service": "IMAP",     "severity": "medium",   "risk": "Cleartext mail — use IMAPS (993) instead"},
    389:   {"service": "LDAP",     "severity": "high",     "risk": "Unencrypted directory access"},
    443:   {"service": "HTTPS",    "severity": "info",     "risk": "Verify TLS version and certificate validity"},
    445:   {"service": "SMB",      "severity": "critical", "risk": "EternalBlue (MS17-010) and ransomware vector"},
    512:   {"service": "rexec",    "severity": "critical", "risk": "Legacy remote exec — no auth"},
    513:   {"service": "rlogin",   "severity": "critical", "risk": "Legacy remote login — no auth"},
    514:   {"service": "rsh",      "severity": "critical", "risk": "Remote shell with no auth"},
    1433:  {"service": "MSSQL",    "severity": "high",     "risk": "Database exposed — restrict to localhost"},
    1900:  {"service": "UPnP",     "severity": "high",     "risk": "UPnP exposes internal services; DDoS amplification"},
    2323:  {"service": "Telnet",   "severity": "critical", "risk": "Alt-port Telnet — IoT default credential target"},
    3306:  {"service": "MySQL",    "severity": "high",     "risk": "Database exposed — restrict to localhost"},
    3389:  {"service": "RDP",      "severity": "critical", "risk": "BlueKeep (CVE-2019-0708), brute-force target"},
    5432:  {"service": "PostgreSQL","severity": "high",    "risk": "Database exposed — restrict to localhost"},
    5900:  {"service": "VNC",      "severity": "critical", "risk": "Screen sharing; often weak/no auth"},
    5901:  {"service": "VNC-1",    "severity": "critical", "risk": "VNC display 1 — see VNC 5900 risks"},
    6379:  {"service": "Redis",    "severity": "critical", "risk": "No auth by default; remote code execution via SLAVEOF"},
    7547:  {"service": "CWMP/TR-069","severity":"critical","risk": "Router management — ISP backdoor, exploited by Mirai"},
    8080:  {"service": "HTTP-alt", "severity": "medium",   "risk": "Alt-HTTP; verify HTTPS redirect"},
    8443:  {"service": "HTTPS-alt","severity": "low",      "risk": "Check TLS config"},
    8888:  {"service": "Jupyter",  "severity": "critical", "risk": "Jupyter Notebook — code execution, often no auth"},
    27017: {"service": "MongoDB",  "severity": "critical", "risk": "MongoDB — no auth by default in older versions"},
    9200:  {"service": "Elasticsearch","severity":"critical","risk": "Elasticsearch — no auth by default, data exposure"},
    9300:  {"service": "Elasticsearch cluster","severity":"high","risk": "Cluster comms port"},
    11211: {"service": "Memcached","severity": "high",     "risk": "DDoS amplification; no auth by default"},
}

def map_port_vulns(open_ports: dict[str, list]) -> list[dict]:
    """Map open ports to known vulnerability patterns."""
    findings = []
    for proto, ports in open_ports.items():
        for p in ports:
            port = p.get("port") or p.get("number")
            if port and port in _PORT_VULNS:
                v = _PORT_VULNS[port]
                findings.append({
                    "port": port,
                    "proto": proto,
                    "service": p.get("service") or v["service"],
                    "version": p.get("version", ""),
                    "severity": v["severity"],
                    "risk": v["risk"],
                })
    return sorted(findings, key=lambda x: {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}.get(x["severity"], 5))


# ── DNS Security ─────────────────────────────────────────────────────────────

def dns_security_check(domain: str) -> dict[str, Any]:
    """Check SPF, DMARC, DNSSEC for a domain."""
    result: dict[str, Any] = {
        "domain": domain,
        "spf": None,
        "dmarc": None,
        "issues": [],
    }
    try:
        import dns.resolver  # type: ignore
        # SPF
        try:
            txt = dns.resolver.resolve(domain, "TXT")
            for r in txt:
                s = r.to_text().strip('"')
                if s.startswith("v=spf1"):
                    result["spf"] = s
                    break
        except Exception:
            pass

        if not result["spf"]:
            result["issues"].append("No SPF record — email spoofing possible")

        # DMARC
        try:
            dm = dns.resolver.resolve(f"_dmarc.{domain}", "TXT")
            for r in dm:
                s = r.to_text().strip('"')
                if s.startswith("v=DMARC1"):
                    result["dmarc"] = s
                    if "p=none" in s:
                        result["issues"].append("DMARC policy is 'none' — no enforcement")
                    break
        except Exception:
            pass

        if not result["dmarc"]:
            result["issues"].append("No DMARC record — phishing protection absent")

    except ImportError:
        result["issues"].append("dnspython not available")
    except Exception as e:
        result["issues"].append(str(e))

    return result


# ── Traceroute ───────────────────────────────────────────────────────────────

def traceroute(target: str, max_hops: int = 20) -> list[dict]:
    """Run traceroute to target. Returns list of hops."""
    hops = []
    try:
        out = subprocess.run(
            ["traceroute", "-n", "-m", str(max_hops), "-w", "1", target],
            capture_output=True, text=True, timeout=60,
        ).stdout
        for line in out.splitlines():
            m = re.match(r"^\s*(\d+)\s+([\d.*]+)\s*(.*)", line)
            if m:
                hop_num = int(m.group(1))
                addr = m.group(2)
                rest = m.group(3).strip()
                # Extract latency values
                latencies = re.findall(r"(\d+\.\d+)\s*ms", rest)
                hops.append({
                    "hop": hop_num,
                    "address": addr if addr != "*" else None,
                    "rtt_ms": [float(x) for x in latencies],
                    "timeout": addr == "*",
                })
    except Exception as e:
        logger.warning("Traceroute failed", target=target, error=str(e))
    return hops


# ── Full Device Audit ────────────────────────────────────────────────────────

def full_audit(ip: str, hostname: str | None = None, open_ports: dict | None = None) -> dict[str, Any]:
    """Run comprehensive audit on a single target. Returns all findings."""
    report: dict[str, Any] = {
        "ip": ip,
        "hostname": hostname,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "ssl": [],
        "http": [],
        "banners": {},
        "port_vulns": [],
        "dns": None,
        "overall_severity": "info",
    }

    # SSL checks on common HTTPS ports
    ssl_ports = [443, 8443, 8080]
    if open_ports:
        for proto, ports in open_ports.items():
            for p in ports:
                port = p.get("port") or p.get("number")
                svc = (p.get("service") or "").lower()
                if port and ("https" in svc or "ssl" in svc or "tls" in svc):
                    if port not in ssl_ports:
                        ssl_ports.append(port)

    for port in ssl_ports:
        if _port_open(ip, port):
            ssl_res = ssl_check(ip, port, hostname=hostname)
            if ssl_res.get("ok") or ssl_res.get("error"):
                report["ssl"].append(ssl_res)

    # HTTP security headers
    http_ports = [(80, False), (443, True), (8080, False), (8443, True)]
    if open_ports:
        for proto, ports in open_ports.items():
            for p in ports:
                port = p.get("port") or p.get("number")
                if port and port not in [x[0] for x in http_ports]:
                    svc = (p.get("service") or "").lower()
                    if "http" in svc:
                        http_ports.append((port, "https" in svc))

    for port, https in http_ports:
        if _port_open(ip, port):
            h = http_security_check(ip, port, use_https=https, hostname=hostname)
            if h.get("ok"):
                report["http"].append(h)

    # Banner grab interesting ports
    grab_ports = [21, 22, 23, 25, 110, 143, 3306, 5432, 6379, 27017, 9200]
    if open_ports:
        all_open = [p.get("port") or p.get("number") for pl in open_ports.values() for p in pl]
        grab_ports = [p for p in grab_ports if p in all_open]
    for port in grab_ports[:8]:
        if _port_open(ip, port):
            banner = grab_banner(ip, port)
            if banner:
                report["banners"][port] = banner[:200]

    # Port vuln mapping
    if open_ports:
        report["port_vulns"] = map_port_vulns(open_ports)

    # DNS security if hostname looks like a domain
    if hostname and "." in hostname and not hostname[0].isdigit():
        domain_parts = hostname.rsplit(".", 2)
        if len(domain_parts) >= 2:
            apex = ".".join(domain_parts[-2:])
            report["dns"] = dns_security_check(apex)

    # Overall severity — highest finding
    sev_rank = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}
    all_sevs: list[str] = []
    for pv in report["port_vulns"]:
        all_sevs.append(pv["severity"])
    for s in report["ssl"]:
        if s.get("expired"):
            all_sevs.append("critical")
        elif s.get("expiring_soon") or s.get("weak_protocol") or s.get("weak_cipher"):
            all_sevs.append("high")
        elif s.get("self_signed"):
            all_sevs.append("medium")
    if all_sevs:
        report["overall_severity"] = min(all_sevs, key=lambda x: sev_rank.get(x, 9))

    return report


def _port_open(ip: str, port: int, timeout: float = 1.5) -> bool:
    try:
        with socket.create_connection((ip, port), timeout=timeout):
            return True
    except Exception:
        return False
