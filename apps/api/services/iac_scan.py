"""IaC scanner — trivy config + custom rules for Dockerfile, K8s, Terraform, Compose."""
import json
import re
import subprocess
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import structlog

logger = structlog.get_logger()

SEVERITY_ORDER = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3, "INFO": 4, "UNKNOWN": 5}

IAC_EXTENSIONS = {
    ".tf", ".tfvars",                # Terraform
    ".yaml", ".yml",                 # Kubernetes / Compose
    ".json",                         # CloudFormation / k8s
    "Dockerfile",                    # Docker
    ".bicep",                        # Azure Bicep
    ".hcl",                          # HCL
}

SKIP_DIRS = {"node_modules", ".git", ".venv", "venv", "__pycache__", "dist", "build"}

# ── Custom Dockerfile rules ───────────────────────────────────────────────────

DOCKERFILE_RULES = [
    {
        "id": "DF001",
        "title": "Running as root",
        "pattern": r"^USER\s+root",
        "severity": "HIGH",
        "description": "Container runs as root — privilege escalation risk.",
        "fix": "Add USER nonroot or USER 1000 to run as non-root.",
    },
    {
        "id": "DF002",
        "title": "Latest tag used",
        "pattern": r"FROM\s+\S+:latest",
        "severity": "MEDIUM",
        "description": "Using ':latest' tag makes builds non-reproducible.",
        "fix": "Pin to a specific version: e.g., FROM nginx:1.25.3",
    },
    {
        "id": "DF003",
        "title": "No USER instruction",
        "pattern": None,
        "check": lambda lines: not any("USER" in l and "root" not in l for l in lines),
        "severity": "HIGH",
        "description": "No USER instruction — container runs as root by default.",
        "fix": "Add 'USER nonroot' or 'USER 1000' before CMD/ENTRYPOINT.",
    },
    {
        "id": "DF004",
        "title": "Hardcoded secret in ENV/ARG",
        "pattern": r"(?i)(ENV|ARG)\s+\S*(password|secret|key|token|api_key)\s*=\s*\S+",
        "severity": "CRITICAL",
        "description": "Secret hardcoded in Dockerfile ENV/ARG — visible in image layers.",
        "fix": "Pass secrets at runtime via --secret or environment injection.",
    },
    {
        "id": "DF005",
        "title": "curl/wget piped to shell",
        "pattern": r"(curl|wget)\s.*\|\s*(bash|sh|python|ruby)",
        "severity": "CRITICAL",
        "description": "Downloading and executing code from the internet without verification.",
        "fix": "Download, verify signature, then execute in separate steps.",
    },
    {
        "id": "DF006",
        "title": "COPY --chown not used",
        "pattern": None,
        "check": lambda lines: any("COPY" in l for l in lines) and not any("--chown" in l for l in lines),
        "severity": "LOW",
        "description": "Files copied without explicit ownership — may be root-owned.",
        "fix": "Use COPY --chown=user:group to set file ownership.",
    },
    {
        "id": "DF007",
        "title": "ADD with URL",
        "pattern": r"^ADD\s+https?://",
        "severity": "MEDIUM",
        "description": "ADD with URL fetches content at build time without checksum verification.",
        "fix": "Use curl --fail with explicit checksum verification instead.",
    },
    {
        "id": "DF008",
        "title": "No health check",
        "pattern": None,
        "check": lambda lines: not any("HEALTHCHECK" in l for l in lines),
        "severity": "LOW",
        "description": "No HEALTHCHECK defined — container orchestrators cannot detect unhealthy state.",
        "fix": "Add HEALTHCHECK instruction to verify service health.",
    },
]

# ── Docker Compose rules ──────────────────────────────────────────────────────

COMPOSE_RULES = [
    {
        "id": "DC001",
        "pattern": r"privileged:\s*true",
        "severity": "CRITICAL",
        "title": "Privileged container",
        "description": "Container runs in privileged mode — full host access.",
        "fix": "Remove privileged: true and use specific capabilities instead.",
    },
    {
        "id": "DC002",
        "pattern": r"user:\s*root|user:\s*0",
        "severity": "HIGH",
        "title": "Container running as root",
        "description": "Explicit root user in compose file.",
        "fix": "Specify a non-root user.",
    },
    {
        "id": "DC003",
        "pattern": r"network_mode:\s*host",
        "severity": "HIGH",
        "title": "Host network mode",
        "description": "Container shares host network stack — bypasses network isolation.",
        "fix": "Use bridge networking with explicit port mappings.",
    },
    {
        "id": "DC004",
        "pattern": r"pid:\s*host",
        "severity": "HIGH",
        "title": "Host PID namespace",
        "description": "Container can see all host processes.",
        "fix": "Remove pid: host.",
    },
    {
        "id": "DC005",
        "pattern": r'- "[0-9]+:[0-9]+"',
        "severity": "LOW",
        "title": "Port exposed on all interfaces",
        "description": "Binding to 0.0.0.0 exposes port on all network interfaces.",
        "fix": "Bind to specific interface: '127.0.0.1:8080:8080'",
    },
    {
        "id": "DC006",
        "pattern": r"restart:\s*always",
        "severity": "INFO",
        "title": "Always restart policy",
        "description": "Container restarts indefinitely on failure — may mask crashes.",
        "fix": "Consider 'restart: on-failure:3' to limit restart attempts.",
    },
]


def _scan_dockerfile(fpath: Path, root: Path) -> list[dict]:
    findings = []
    try:
        content = fpath.read_text(errors="replace")
        lines = content.splitlines()

        for rule in DOCKERFILE_RULES:
            if rule.get("pattern"):
                for i, line in enumerate(lines):
                    if re.search(rule["pattern"], line, re.IGNORECASE):
                        findings.append({
                            "id": rule["id"],
                            "title": rule["title"],
                            "severity": rule["severity"],
                            "file": str(fpath.relative_to(root)),
                            "line": i + 1,
                            "snippet": line.strip()[:200],
                            "description": rule["description"],
                            "fix": rule["fix"],
                            "category": "dockerfile",
                        })
            elif rule.get("check") and rule["check"](lines):
                findings.append({
                    "id": rule["id"],
                    "title": rule["title"],
                    "severity": rule["severity"],
                    "file": str(fpath.relative_to(root)),
                    "line": 0,
                    "snippet": "",
                    "description": rule["description"],
                    "fix": rule["fix"],
                    "category": "dockerfile",
                })
    except Exception as e:
        logger.warning("Dockerfile scan error", file=str(fpath), error=str(e))
    return findings


def _scan_compose(fpath: Path, root: Path) -> list[dict]:
    findings = []
    try:
        content = fpath.read_text(errors="replace")
        for rule in COMPOSE_RULES:
            for i, line in enumerate(content.splitlines()):
                if re.search(rule["pattern"], line, re.IGNORECASE):
                    findings.append({
                        "id": rule["id"],
                        "title": rule["title"],
                        "severity": rule["severity"],
                        "file": str(fpath.relative_to(root)),
                        "line": i + 1,
                        "snippet": line.strip()[:200],
                        "description": rule["description"],
                        "fix": rule["fix"],
                        "category": "docker-compose",
                    })
    except Exception as e:
        logger.warning("Compose scan error", file=str(fpath), error=str(e))
    return findings


def _run_trivy_fs(path: str) -> list[dict]:
    """Run trivy fs for IaC misconfigurations."""
    findings = []
    try:
        result = subprocess.run(
            [
                "trivy", "fs",
                "--scanners", "misconfig,secret",
                "--format", "json",
                "--quiet",
                "--timeout", "60s",
                path,
            ],
            capture_output=True, text=True, timeout=90,
        )
        if result.stdout:
            data = json.loads(result.stdout)
            for res in data.get("Results", []):
                for m in res.get("Misconfigurations", []):
                    findings.append({
                        "id": m.get("ID", ""),
                        "title": m.get("Title", ""),
                        "severity": m.get("Severity", "MEDIUM").upper(),
                        "file": res.get("Target", ""),
                        "line": m.get("CauseMetadata", {}).get("StartLine", 0),
                        "snippet": m.get("CauseMetadata", {}).get("Code", {}).get("Lines", [{}])[0].get("Content", "")[:200] if m.get("CauseMetadata", {}).get("Code", {}).get("Lines") else "",
                        "description": m.get("Description", "")[:400],
                        "fix": m.get("Resolution", ""),
                        "category": "trivy-" + res.get("Class", "config"),
                        "references": m.get("References", [])[:3],
                    })
                for s in res.get("Secrets", []):
                    findings.append({
                        "id": s.get("RuleID", ""),
                        "title": f"Secret: {s.get('Title', '')}",
                        "severity": s.get("Severity", "HIGH").upper(),
                        "file": res.get("Target", ""),
                        "line": s.get("StartLine", 0),
                        "snippet": s.get("Match", "")[:100],
                        "description": f"Hardcoded secret detected: {s.get('Title', '')}",
                        "fix": "Remove from IaC files and rotate the secret immediately.",
                        "category": "secrets",
                        "references": [],
                    })
    except subprocess.TimeoutExpired:
        logger.warning("trivy fs timeout", path=path)
    except Exception as e:
        logger.warning("trivy fs error", error=str(e))
    return findings


def scan_iac(path: str) -> dict[str, Any]:
    """Scan IaC files: Dockerfile, docker-compose, Terraform, Kubernetes."""
    root = Path(path)
    if not root.exists():
        return {"error": f"Path not found: {path}"}

    findings: list[dict] = []

    # Custom Dockerfile checks
    for fpath in root.rglob("Dockerfile*"):
        if any(p in SKIP_DIRS for p in fpath.parts):
            continue
        findings.extend(_scan_dockerfile(fpath, root))

    for fpath in root.rglob("*.Dockerfile"):
        if any(p in SKIP_DIRS for p in fpath.parts):
            continue
        findings.extend(_scan_dockerfile(fpath, root))

    # Custom Compose checks
    for pattern in ("docker-compose*.yml", "docker-compose*.yaml", "compose.yml", "compose.yaml"):
        for fpath in root.rglob(pattern):
            if any(p in SKIP_DIRS for p in fpath.parts):
                continue
            findings.extend(_scan_compose(fpath, root))

    # Trivy IaC scan (Terraform, K8s, Helm, etc.)
    trivy_findings = _run_trivy_fs(path)
    findings.extend(trivy_findings)

    # Deduplicate
    seen: set[tuple[str, str, int]] = set()
    unique: list[dict] = []
    for f in findings:
        key = (f["id"], f["file"], f.get("line", 0))
        if key not in seen:
            seen.add(key)
            unique.append(f)

    unique.sort(key=lambda x: SEVERITY_ORDER.get(x["severity"], 9))

    counts = {"CRITICAL": 0, "HIGH": 0, "MEDIUM": 0, "LOW": 0}
    for f in unique:
        sev = f["severity"]
        if sev in counts:
            counts[sev] += 1

    return {
        "scan_type": "iac",
        "path": path,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "findings": unique,
        "summary": {
            **counts,
            "total": len(unique),
        },
    }
