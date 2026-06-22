"""Vulnerability scanning endpoints — dependencies, SAST, container, IaC, full scan."""
import os
import json
import uuid
from typing import Any
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel, field_validator

from core.deps import get_current_user
from models.user import User

router = APIRouter(prefix="/vulnscan", tags=["vulnscan"])

MAX_PATH_DEPTH = 20


class ScanRequest(BaseModel):
    path: str

    @field_validator("path")
    @classmethod
    def validate_path(cls, v: str) -> str:
        p = Path(v).expanduser().resolve()
        if not p.exists():
            raise ValueError(f"Path does not exist: {v}")
        if not p.is_dir():
            raise ValueError(f"Path must be a directory: {v}")
        return str(p)


class ContainerScanRequest(BaseModel):
    image: str


class WebAppScanRequest(BaseModel):
    url: str


@router.post("/dependencies")
async def scan_dependencies(
    body: ScanRequest,
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Scan a project directory for dependency vulnerabilities (OSV.dev + pip-audit + npm audit)."""
    from services.depcheck import scan_dependencies as _scan
    result = _scan(body.path)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@router.post("/sast")
async def scan_sast(
    body: ScanRequest,
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """SAST scan — semgrep (multi-language) + bandit (Python) + secrets detection."""
    from services.sast import scan_sast as _scan
    result = _scan(body.path)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@router.post("/container")
async def scan_container(
    body: ContainerScanRequest,
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Scan a Docker image for OS-level and app-level CVEs using trivy."""
    from services.container_scan import scan_container as _scan
    return _scan(body.image)


@router.post("/iac")
async def scan_iac(
    body: ScanRequest,
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """IaC scan — Dockerfile, docker-compose, Terraform, Kubernetes manifests."""
    from services.iac_scan import scan_iac as _scan
    result = _scan(body.path)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@router.post("/full")
async def full_scan(
    body: ScanRequest,
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Run all scanners on a directory: dependencies + SAST + IaC."""
    from services.depcheck import scan_dependencies
    from services.sast import scan_sast
    from services.iac_scan import scan_iac

    dep_result = scan_dependencies(body.path)
    sast_result = scan_sast(body.path)
    iac_result = scan_iac(body.path)

    # Build unified severity summary
    sev_rank = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3, "UNKNOWN": 4}
    overall = "info"
    all_sevs = []
    for v in dep_result.get("vulnerabilities", []):
        all_sevs.append(v["severity"])
    for f in sast_result.get("findings", []):
        all_sevs.append(f["severity"])
    for f in iac_result.get("findings", []):
        all_sevs.append(f["severity"])

    if all_sevs:
        overall = min(all_sevs, key=lambda x: sev_rank.get(x, 9))

    return {
        "scan_type": "full",
        "path": body.path,
        "overall_severity": overall.lower(),
        "dependencies": dep_result,
        "sast": sast_result,
        "iac": iac_result,
        "summary": {
            "dep_vulns": dep_result.get("summary", {}).get("total", 0),
            "sast_findings": sast_result.get("summary", {}).get("total", 0),
            "iac_findings": iac_result.get("summary", {}).get("total", 0),
            "secrets": (sast_result.get("summary", {}).get("secrets", 0)
                        + iac_result.get("summary", {}).get("secrets", 0)),
            "critical": sum(1 for s in all_sevs if s == "CRITICAL"),
            "high": sum(1 for s in all_sevs if s == "HIGH"),
            "medium": sum(1 for s in all_sevs if s == "MEDIUM"),
            "low": sum(1 for s in all_sevs if s == "LOW"),
        },
    }
