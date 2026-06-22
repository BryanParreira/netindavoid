"""Container image scanner — trivy for OS + language-level CVEs in Docker images."""
import json
import subprocess
import os
from datetime import datetime, timezone
from typing import Any

import structlog

logger = structlog.get_logger()

SEVERITY_ORDER = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3, "UNKNOWN": 4}


def _trivy_image(target: str, timeout: int = 120) -> dict[str, Any] | None:
    """Run trivy image scan. Returns raw trivy JSON or None on failure."""
    try:
        result = subprocess.run(
            [
                "trivy", "image",
                "--format", "json",
                "--quiet",
                "--timeout", f"{timeout}s",
                "--scanners", "vuln,secret,misconfig",
                target,
            ],
            capture_output=True, text=True, timeout=timeout + 30,
        )
        if result.stdout:
            return json.loads(result.stdout)
    except subprocess.TimeoutExpired:
        logger.warning("trivy image timeout", target=target)
    except FileNotFoundError:
        logger.warning("trivy not found")
    except Exception as e:
        logger.warning("trivy error", error=str(e))
    return None


def _parse_trivy(data: dict, target: str) -> dict[str, Any]:
    vulns: list[dict] = []
    secrets: list[dict] = []
    misconfigs: list[dict] = []

    for result in data.get("Results", []):
        class_type = result.get("Class", "")
        # Vulnerabilities
        for v in result.get("Vulnerabilities", []):
            sev = v.get("Severity", "UNKNOWN").upper()
            fixed = v.get("FixedVersion", "")
            cvss = None
            for scores in v.get("CVSS", {}).values():
                if "V3Score" in scores:
                    cvss = float(scores["V3Score"])
                    break
            vulns.append({
                "id": v.get("VulnerabilityID", ""),
                "cve_ids": [v.get("VulnerabilityID", "")] if v.get("VulnerabilityID", "").startswith("CVE") else [],
                "package": v.get("PkgName", ""),
                "version": v.get("InstalledVersion", ""),
                "ecosystem": result.get("Type", "os"),
                "layer": result.get("Target", ""),
                "title": v.get("Title", v.get("VulnerabilityID", "")),
                "description": (v.get("Description") or "")[:400],
                "severity": sev,
                "cvss_score": cvss,
                "fix_available": bool(fixed),
                "fix_versions": [fixed] if fixed else [],
                "references": v.get("References", [])[:3],
                "published": v.get("PublishedDate", ""),
            })

        # Secrets
        for s in result.get("Secrets", []):
            secrets.append({
                "rule_id": s.get("RuleID", ""),
                "title": s.get("Title", ""),
                "severity": s.get("Severity", "HIGH").upper(),
                "file": result.get("Target", ""),
                "line": s.get("StartLine", 0),
                "match": s.get("Match", "")[:100],
                "category": "secrets",
            })

        # Misconfigurations
        for m in result.get("Misconfigurations", []):
            misconfigs.append({
                "id": m.get("ID", ""),
                "title": m.get("Title", ""),
                "description": m.get("Description", "")[:400],
                "severity": m.get("Severity", "MEDIUM").upper(),
                "file": result.get("Target", ""),
                "resolution": m.get("Resolution", ""),
                "references": m.get("References", [])[:3],
                "category": "misconfiguration",
            })

    vulns.sort(key=lambda x: SEVERITY_ORDER.get(x["severity"], 9))
    counts = {"CRITICAL": 0, "HIGH": 0, "MEDIUM": 0, "LOW": 0, "UNKNOWN": 0}
    for v in vulns:
        counts[v["severity"]] = counts.get(v["severity"], 0) + 1

    # Image metadata
    meta = data.get("Metadata", {})
    image_info = {
        "image": target,
        "os": meta.get("OS", {}).get("Family", "") + " " + meta.get("OS", {}).get("Name", ""),
        "image_id": (data.get("ArtifactName") or target),
        "created": meta.get("ImageConfig", {}).get("created", ""),
    }

    return {
        "scan_type": "container",
        "target": target,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "image": image_info,
        "vulnerabilities": vulns,
        "secrets": secrets,
        "misconfigurations": misconfigs,
        "summary": {
            **counts,
            "total": len(vulns),
            "fix_available": sum(1 for v in vulns if v["fix_available"]),
            "secrets": len(secrets),
            "misconfigs": len(misconfigs),
        },
    }


def scan_container(image: str) -> dict[str, Any]:
    """Scan a Docker image with trivy. image can be 'nginx:latest', 'sha256:...', etc."""
    data = _trivy_image(image)
    if not data:
        return {
            "scan_type": "container",
            "target": image,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "error": "trivy scan failed or image not found",
            "vulnerabilities": [],
            "summary": {"total": 0},
        }
    return _parse_trivy(data, image)
