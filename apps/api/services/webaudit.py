"""Web application security audit — headers, SSL, sensitive paths, tech fingerprint, CORS."""
import ssl
import socket
import urllib.request
import urllib.error
import urllib.parse
import re
from datetime import datetime, timezone
from typing import Any

import structlog

logger = structlog.get_logger()

# Paths that should NOT be publicly accessible
SENSITIVE_PATHS = [
    "/.git/HEAD",
    "/.git/config",
    "/.env",
    "/.env.local",
    "/.env.production",
    "/wp-admin/",
    "/wp-config.php",
    "/phpinfo.php",
    "/.htaccess",
    "/web.config",
    "/config.php",
    "/database.yml",
    "/config/database.yml",
    "/package.json",
    "/composer.json",
    "/Dockerfile",
    "/docker-compose.yml",
    "/api/swagger.json",
    "/api/openapi.json",
    "/swagger.json",
    "/openapi.json",
    "/graphql",
    "/__debug__/",
    "/debug/",
    "/admin/",
    "/phpmyadmin/",
    "/pma/",
    "/adminer/",
]

# Known tech fingerprints from response headers
TECH_PATTERNS: list[tuple[str, str, str]] = [
    ("Server", r"nginx/(\S+)", "nginx"),
    ("Server", r"Apache/(\S+)", "Apache"),
    ("Server", r"Microsoft-IIS/(\S+)", "IIS"),
    ("Server", r"Caddy", "Caddy"),
    ("X-Powered-By", r"PHP/(\S+)", "PHP"),
    ("X-Powered-By", r"Express", "Express.js"),
    ("X-Powered-By", r"ASP\.NET", "ASP.NET"),
    ("X-Generator", r"(.+)", "CMS"),
    ("X-Drupal-Cache", r".*", "Drupal"),
    ("X-WP-Nonce", r".*", "WordPress"),
    ("X-Shopify-Stage", r".*", "Shopify"),
]

SECURITY_HEADERS = {
    "strict-transport-security": "HSTS — prevents SSL stripping",
    "x-frame-options": "Clickjacking protection",
    "x-content-type-options": "MIME sniffing prevention",
    "content-security-policy": "XSS/injection policy",
    "referrer-policy": "Referrer information control",
    "permissions-policy": "Browser feature policy",
    "x-xss-protection": "Legacy XSS filter (deprecated but checked)",
}

CORS_RISKY = {"*", "null"}


def _make_ssl_ctx() -> ssl.SSLContext:
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


def _fetch(url: str, method: str = "GET", timeout: float = 8.0,
           extra_headers: dict | None = None) -> tuple[int, dict[str, str], str]:
    """Return (status_code, headers_lower, body[:4096])."""
    req = urllib.request.Request(url, method=method,
                                  headers={"User-Agent": "NetindavoidAudit/1.0"})
    if extra_headers:
        for k, v in extra_headers.items():
            req.add_header(k, v)
    ctx = _make_ssl_ctx() if url.startswith("https://") else None
    resp = urllib.request.urlopen(req, timeout=timeout, context=ctx)
    headers = {k.lower(): v for k, v in resp.headers.items()}
    body = resp.read(4096).decode("utf-8", errors="replace")
    return resp.status, headers, body


def webapp_audit(url: str) -> dict[str, Any]:
    """Full web application security audit on a URL."""
    parsed = urllib.parse.urlparse(url)
    if not parsed.scheme:
        url = "https://" + url
        parsed = urllib.parse.urlparse(url)
    scheme = parsed.scheme
    hostname = parsed.hostname or ""
    port = parsed.port or (443 if scheme == "https" else 80)
    base_url = f"{scheme}://{parsed.netloc}"

    report: dict[str, Any] = {
        "url": url,
        "hostname": hostname,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "reachable": False,
        "status_code": None,
        "ssl": None,
        "headers": {},
        "missing_security_headers": [],
        "security_header_issues": [],
        "tech_fingerprint": [],
        "cookies": [],
        "cors": None,
        "sensitive_paths": [],
        "dns": None,
        "redirect_to_https": None,
        "overall_severity": "info",
        "findings": [],
    }

    # ── SSL check ────────────────────────────────────────────────────────────
    if scheme == "https":
        from services.audit import ssl_check as _ssl_check
        try:
            ip = socket.gethostbyname(hostname)
            report["ssl"] = _ssl_check(ip, port=port, hostname=hostname)
        except Exception:
            pass

    # ── Main request ────────────────────────────────────────────────────────
    try:
        status, headers, body = _fetch(url)
        report["reachable"] = True
        report["status_code"] = status
        report["headers"] = {k: v for k, v in headers.items() if not k.startswith(":")}
    except urllib.error.HTTPError as e:
        report["reachable"] = True
        report["status_code"] = e.code
        headers = {k.lower(): v for k, v in e.headers.items()}
        body = ""
        report["headers"] = headers
    except Exception as e:
        report["findings"].append({"severity": "high", "title": "Unreachable", "detail": str(e)})
        report["overall_severity"] = "high"
        return report

    # ── Check HTTPS redirect (if HTTP) ──────────────────────────────────────
    if scheme == "http":
        try:
            http_url = url.replace("https://", "http://", 1)
            s2, h2, _ = _fetch(http_url, timeout=4.0)
            loc = h2.get("location", "")
            report["redirect_to_https"] = loc.startswith("https://")
            if not report["redirect_to_https"]:
                report["findings"].append({
                    "severity": "high",
                    "title": "No HTTPS redirect",
                    "detail": "HTTP traffic is not redirected to HTTPS. Credentials could be intercepted.",
                })
        except Exception:
            pass

    # ── Security headers ────────────────────────────────────────────────────
    for hdr, desc in SECURITY_HEADERS.items():
        if hdr not in headers:
            report["missing_security_headers"].append({"header": hdr, "description": desc})
            if hdr in {"content-security-policy", "strict-transport-security"}:
                report["findings"].append({
                    "severity": "medium",
                    "title": f"Missing {hdr.upper()}",
                    "detail": f"{desc} is not set.",
                })
        else:
            val = headers[hdr]
            # Check specific header quality
            if hdr == "strict-transport-security":
                if "includeSubDomains" not in val:
                    report["security_header_issues"].append(f"HSTS missing 'includeSubDomains'")
                if "max-age" in val:
                    ma = re.search(r"max-age=(\d+)", val)
                    if ma and int(ma.group(1)) < 31536000:
                        report["security_header_issues"].append(f"HSTS max-age < 1 year ({ma.group(1)}s)")
            if hdr == "x-frame-options" and val.upper() not in {"DENY", "SAMEORIGIN"}:
                report["security_header_issues"].append(f"X-Frame-Options value '{val}' is permissive")
            if hdr == "content-security-policy":
                if "'unsafe-inline'" in val:
                    report["findings"].append({"severity": "medium", "title": "CSP allows unsafe-inline", "detail": "CSP 'unsafe-inline' disables inline script protection."})
                if "'unsafe-eval'" in val:
                    report["findings"].append({"severity": "medium", "title": "CSP allows unsafe-eval", "detail": "CSP 'unsafe-eval' allows dynamic code execution."})

    # ── Server / info disclosure ─────────────────────────────────────────────
    server = headers.get("server", "")
    powered = headers.get("x-powered-by", "")
    if server:
        report["findings"].append({"severity": "low", "title": "Server header exposed", "detail": f"Server: {server} — reveals backend software version."})
    if powered:
        report["findings"].append({"severity": "low", "title": "X-Powered-By exposed", "detail": f"X-Powered-By: {powered} — reveals tech stack."})

    # ── Technology fingerprinting ─────────────────────────────────────────────
    for header_name, pattern, tech in TECH_PATTERNS:
        val = headers.get(header_name.lower(), "")
        if val:
            m = re.search(pattern, val, re.IGNORECASE)
            if m:
                ver = m.group(1) if m.lastindex and m.lastindex >= 1 else ""
                entry = {"tech": tech, "version": ver, "via": header_name}
                if entry not in report["tech_fingerprint"]:
                    report["tech_fingerprint"].append(entry)

    # Body-based fingerprinting
    if body:
        if "wp-content" in body or "wp-includes" in body:
            report["tech_fingerprint"].append({"tech": "WordPress", "version": "", "via": "body"})
        if "Joomla" in body:
            report["tech_fingerprint"].append({"tech": "Joomla", "version": "", "via": "body"})
        if "__next" in body or "_next/static" in body:
            report["tech_fingerprint"].append({"tech": "Next.js", "version": "", "via": "body"})
        if "react-root" in body or "reactDOM" in body:
            report["tech_fingerprint"].append({"tech": "React", "version": "", "via": "body"})

    # ── CORS ────────────────────────────────────────────────────────────────
    try:
        _, cors_headers, _ = _fetch(url, extra_headers={"Origin": "https://evil.com"}, timeout=5)
        acao = cors_headers.get("access-control-allow-origin", "")
        acac = cors_headers.get("access-control-allow-credentials", "")
        if acao:
            risky = acao in CORS_RISKY or acao == "https://evil.com"
            creds_with_wildcard = acao == "*" and acac.lower() == "true"
            report["cors"] = {
                "allow_origin": acao,
                "allow_credentials": acac,
                "risky": risky,
            }
            if risky:
                report["findings"].append({
                    "severity": "critical" if creds_with_wildcard else "high",
                    "title": "CORS misconfiguration",
                    "detail": f"Access-Control-Allow-Origin: {acao} — cross-origin requests from any domain allowed."
                    + (" With credentials=true this enables credential theft." if creds_with_wildcard else ""),
                })
    except Exception:
        pass

    # ── Cookies ─────────────────────────────────────────────────────────────
    set_cookie = headers.get("set-cookie", "")
    if set_cookie:
        cookies = set_cookie.split(",") if "," in set_cookie else [set_cookie]
        for cookie in cookies:
            cookie = cookie.strip()
            name = cookie.split("=")[0].strip()
            secure = "secure" in cookie.lower()
            httponly = "httponly" in cookie.lower()
            samesite = re.search(r"samesite=(\w+)", cookie, re.IGNORECASE)
            entry = {
                "name": name,
                "secure": secure,
                "httponly": httponly,
                "samesite": samesite.group(1) if samesite else None,
            }
            report["cookies"].append(entry)
            if not secure:
                report["findings"].append({"severity": "medium", "title": f"Cookie '{name}' missing Secure flag", "detail": "Cookie can be sent over HTTP."})
            if not httponly:
                report["findings"].append({"severity": "medium", "title": f"Cookie '{name}' missing HttpOnly flag", "detail": "Cookie accessible via JavaScript — XSS can steal it."})

    # ── Sensitive path check ─────────────────────────────────────────────────
    for path in SENSITIVE_PATHS:
        try:
            purl = base_url.rstrip("/") + path
            s, _, _ = _fetch(purl, timeout=3.0)
            if s in {200, 301, 302, 403}:
                severity = "critical" if s == 200 else "medium"
                report["sensitive_paths"].append({"path": path, "status": s, "severity": severity})
                if s == 200:
                    report["findings"].append({
                        "severity": "critical",
                        "title": f"Sensitive path exposed: {path}",
                        "detail": f"HTTP {s} response — this file/path should not be publicly accessible.",
                    })
        except Exception:
            pass

    # ── DNS security (SPF/DMARC) ─────────────────────────────────────────────
    if hostname and "." in hostname:
        parts = hostname.rsplit(".", 2)
        if len(parts) >= 2:
            from services.audit import dns_security_check
            apex = ".".join(parts[-2:])
            try:
                report["dns"] = dns_security_check(apex)
            except Exception:
                pass

    # ── Overall severity ─────────────────────────────────────────────────────
    rank = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}
    if report["findings"]:
        report["overall_severity"] = min(
            (f["severity"] for f in report["findings"]),
            key=lambda x: rank.get(x, 9)
        )
    if report["ssl"] and report["ssl"].get("expired"):
        report["overall_severity"] = "critical"
    elif report["ssl"] and (report["ssl"].get("expiring_soon") or report["ssl"].get("weak_protocol")):
        cur = rank.get(report["overall_severity"], 4)
        report["overall_severity"] = min(report["overall_severity"], "high", key=lambda x: rank.get(x, 9))

    return report
