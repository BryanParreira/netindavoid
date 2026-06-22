"""SAST scanner — semgrep (code security) + bandit (Python) + secrets detection."""
import json
import re
import subprocess
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import structlog

logger = structlog.get_logger()

SEVERITY_MAP = {
    "ERROR":   "HIGH",
    "WARNING": "MEDIUM",
    "INFO":    "LOW",
    "error":   "HIGH",
    "warning": "MEDIUM",
    "info":    "LOW",
    "HIGH":    "HIGH",
    "MEDIUM":  "MEDIUM",
    "LOW":     "LOW",
}

SKIP_DIRS = {"node_modules", ".git", ".venv", "venv", "__pycache__", "dist",
             "build", ".next", "target", ".nuxt", "coverage"}

# ── Secrets detection patterns ────────────────────────────────────────────────

SECRET_PATTERNS = [
    ("AWS Access Key",        r"AKIA[0-9A-Z]{16}",                         "CRITICAL"),
    ("AWS Secret Key",        r"(?i)aws.{0,20}secret.{0,20}['\"][0-9a-zA-Z/+]{40}['\"]", "CRITICAL"),
    ("GitHub Token",          r"ghp_[0-9a-zA-Z]{36}|github_pat_[0-9a-zA-Z_]{82}", "CRITICAL"),
    ("Stripe Secret",         r"sk_live_[0-9a-zA-Z]{24,}",               "CRITICAL"),
    ("Stripe Publishable",    r"pk_live_[0-9a-zA-Z]{24,}",               "HIGH"),
    ("Google API Key",        r"AIza[0-9A-Za-z\-_]{35}",                 "HIGH"),
    ("Slack Token",           r"xoxb-[0-9]{11}-[0-9]{11}-[a-zA-Z0-9]{24}", "HIGH"),
    ("Discord Token",         r"[MN][A-Za-z\d]{23}\.[\w-]{6}\.[\w-]{27}", "HIGH"),
    ("Twilio Key",            r"SK[0-9a-fA-F]{32}",                      "HIGH"),
    ("Private Key",           r"-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY", "CRITICAL"),
    ("Basic Auth Cred",       r"(?i)(password|passwd|pwd|secret|api_?key)\s*[:=]\s*['\"][^'\"]{8,}['\"]", "HIGH"),
    ("JWT Token",             r"eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}", "MEDIUM"),
    ("Bearer Token",          r"(?i)bearer\s+[a-zA-Z0-9\-_\.]{20,}",    "MEDIUM"),
    ("Generic Secret",        r"(?i)secret[_-]?key\s*=\s*['\"][^'\"]{16,}['\"]", "HIGH"),
    ("Database URL",          r"(?i)(mysql|postgres|mongodb|redis):\/\/[^'\">\s]+:[^'\">\s]+@", "HIGH"),
]

CODE_EXTENSIONS = {
    ".py", ".js", ".ts", ".jsx", ".tsx", ".java", ".go", ".rb", ".php",
    ".cs", ".cpp", ".c", ".h", ".swift", ".kt", ".rs", ".scala",
    ".yaml", ".yml", ".env", ".toml", ".json", ".tf", ".sh", ".bash",
}

SKIP_EXTENSIONS = {".min.js", ".min.css", ".map", ".svg", ".png", ".jpg", ".jpeg",
                   ".gif", ".ico", ".woff", ".woff2", ".ttf", ".eot", ".pdf"}


def _should_scan_file(path: Path) -> bool:
    if path.suffix in SKIP_EXTENSIONS:
        return False
    if path.stat().st_size > 2_000_000:  # skip >2MB files
        return False
    name = path.name.lower()
    # Skip lock files (too noisy)
    if name in {"package-lock.json", "yarn.lock", "poetry.lock", "cargo.lock", "go.sum"}:
        return False
    return path.suffix in CODE_EXTENSIONS or path.name.startswith(".env")


def scan_secrets(path: str) -> list[dict]:
    """Regex-based secrets scanner across all code files."""
    root = Path(path)
    findings: list[dict] = []
    compiled = [(name, re.compile(pattern), sev) for name, pattern, sev in SECRET_PATTERNS]

    for fpath in root.rglob("*"):
        if not fpath.is_file():
            continue
        if any(part in SKIP_DIRS for part in fpath.parts):
            continue
        if not _should_scan_file(fpath):
            continue
        try:
            content = fpath.read_text(errors="replace")
            for name, pattern, severity in compiled:
                for m in pattern.finditer(content):
                    line_num = content[:m.start()].count("\n") + 1
                    snippet = content[max(0, m.start()-30):m.end()+30].replace("\n", " ")
                    # Mask the actual secret value
                    full_match = m.group(0)
                    masked = full_match[:4] + "***" + full_match[-4:] if len(full_match) > 8 else "***"
                    findings.append({
                        "rule_id": f"SECRET.{name.upper().replace(' ', '_')}",
                        "category": "secrets",
                        "title": f"Hardcoded {name}",
                        "severity": severity,
                        "file": str(fpath.relative_to(root)),
                        "line": line_num,
                        "snippet": snippet[:200],
                        "match": masked,
                        "fix": "Move to environment variable or secrets manager. Never commit credentials.",
                    })
        except Exception:
            continue

    return findings


def run_semgrep(path: str) -> list[dict]:
    """Run semgrep with auto + security rules."""
    findings: list[dict] = []
    try:
        result = subprocess.run(
            [
                "semgrep", "scan",
                "--config", "auto",
                "--json",
                "--timeout", "30",
                "--max-memory", "1000",
                "--no-git-ignore",
                path,
            ],
            capture_output=True, text=True, timeout=120,
            env={**os.environ, "SEMGREP_SEND_METRICS": "off"},
        )
        if result.stdout:
            data = json.loads(result.stdout)
            for finding in data.get("results", []):
                sev = finding.get("extra", {}).get("severity", "WARNING")
                meta = finding.get("extra", {}).get("metadata", {})
                findings.append({
                    "rule_id": finding.get("check_id", ""),
                    "category": meta.get("category", "security"),
                    "title": finding.get("extra", {}).get("message", finding.get("check_id", "")),
                    "severity": SEVERITY_MAP.get(sev, "MEDIUM"),
                    "file": os.path.relpath(finding.get("path", ""), path),
                    "line": finding.get("start", {}).get("line", 0),
                    "snippet": finding.get("extra", {}).get("lines", "")[:300],
                    "cwe": meta.get("cwe", []),
                    "owasp": meta.get("owasp", []),
                    "references": meta.get("references", [])[:3],
                    "fix": meta.get("fix", "") or meta.get("message", ""),
                })
    except subprocess.TimeoutExpired:
        logger.warning("semgrep timed out", path=path)
    except FileNotFoundError:
        logger.warning("semgrep not found")
    except Exception as e:
        logger.warning("semgrep error", error=str(e))
    return findings


def run_bandit(path: str) -> list[dict]:
    """Run bandit on Python files for security issues."""
    findings: list[dict] = []
    try:
        result = subprocess.run(
            ["bandit", "-r", path, "-f", "json", "-ll", "--quiet"],
            capture_output=True, text=True, timeout=180,
        )
        if result.stdout:
            data = json.loads(result.stdout)
            for issue in data.get("results", []):
                sev = issue.get("issue_severity", "MEDIUM")
                findings.append({
                    "rule_id": issue.get("test_id", ""),
                    "category": "security",
                    "title": issue.get("issue_text", ""),
                    "severity": sev.upper() if sev.upper() in {"HIGH", "MEDIUM", "LOW"} else "MEDIUM",
                    "file": os.path.relpath(issue.get("filename", ""), path),
                    "line": issue.get("line_number", 0),
                    "snippet": issue.get("code", "")[:300],
                    "cwe": [issue.get("issue_cwe", {}).get("id", "")] if issue.get("issue_cwe") else [],
                    "owasp": [],
                    "references": [issue.get("more_info", "")],
                    "fix": f"CWE-{issue.get('issue_cwe', {}).get('id', '')}: {issue.get('issue_text', '')}",
                })
    except subprocess.TimeoutExpired:
        logger.warning("bandit timed out", path=path)
    except FileNotFoundError:
        logger.warning("bandit not found — skipping Python SAST")
    except Exception as e:
        logger.warning("bandit error", error=str(e))
    return findings


def scan_sast(path: str) -> dict[str, Any]:
    """Full SAST scan: semgrep + bandit + secrets."""
    root = Path(path)
    if not root.exists():
        return {"error": f"Path not found: {path}"}

    secrets = scan_secrets(path)
    semgrep_findings = run_semgrep(path)
    bandit_findings = run_bandit(path)

    # Merge and deduplicate by (rule_id, file, line)
    all_findings: list[dict] = []
    seen: set[tuple[str, str, int]] = set()
    for f in secrets + semgrep_findings + bandit_findings:
        key = (f["rule_id"], f["file"], f.get("line", 0))
        if key not in seen:
            seen.add(key)
            all_findings.append(f)

    sev_order = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3, "INFO": 4}
    all_findings.sort(key=lambda x: sev_order.get(x["severity"], 9))

    counts = {"CRITICAL": 0, "HIGH": 0, "MEDIUM": 0, "LOW": 0}
    for f in all_findings:
        sev = f["severity"]
        if sev in counts:
            counts[sev] += 1

    return {
        "scan_type": "sast",
        "path": path,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "findings": all_findings,
        "summary": {
            **counts,
            "total": len(all_findings),
            "secrets": len(secrets),
            "code_issues": len(semgrep_findings) + len(bandit_findings),
        },
    }
