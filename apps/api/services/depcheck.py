"""Dependency vulnerability scanner — OSV.dev API + pip-audit + npm audit."""
import json
import subprocess
import re
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
import urllib.request
import urllib.error
import structlog

logger = structlog.get_logger()

OSV_BATCH_URL  = "https://api.osv.dev/v1/querybatch"
OSV_QUERY_URL  = "https://api.osv.dev/v1/query"
OSV_VULN_URL   = "https://api.osv.dev/v1/vulns/"  # + {id}

ECOSYSTEM_MAP = {
    "package.json":         "npm",
    "requirements.txt":     "PyPI",
    "requirements.in":      "PyPI",
    "Pipfile":              "PyPI",
    "pyproject.toml":       "PyPI",
    "poetry.lock":          "PyPI",
    "Gemfile.lock":         "RubyGems",
    "go.sum":               "Go",
    "Cargo.lock":           "crates.io",
    "pom.xml":              "Maven",
    "build.gradle":         "Maven",
    "packages.lock.json":   "NuGet",
    "composer.lock":        "Packagist",
}

SEVERITY_ORDER = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3, "UNKNOWN": 4}


def _cvss_to_severity(score: float) -> str:
    if score >= 9.0:   return "CRITICAL"
    if score >= 7.0:   return "HIGH"
    if score >= 4.0:   return "MEDIUM"
    if score > 0:      return "LOW"
    return "UNKNOWN"


def _osv_post(payload: dict) -> dict:
    data = json.dumps(payload).encode()
    req = urllib.request.Request(OSV_BATCH_URL, data=data,
                                  headers={"Content-Type": "application/json"})
    try:
        resp = urllib.request.urlopen(req, timeout=20)
        return json.loads(resp.read())
    except Exception as e:
        logger.warning("OSV API error", error=str(e))
        return {}


def _osv_single(name: str, version: str, ecosystem: str) -> list[dict]:
    payload = {"package": {"name": name, "ecosystem": ecosystem}, "version": version}
    data = json.dumps(payload).encode()
    req = urllib.request.Request(OSV_QUERY_URL, data=data,
                                  headers={"Content-Type": "application/json"})
    try:
        resp = urllib.request.urlopen(req, timeout=10)
        return json.loads(resp.read()).get("vulns", [])
    except Exception:
        return []


def _osv_fetch_vuln(vuln_id: str) -> dict | None:
    """Fetch full vuln data (with severity) from /v1/vulns/{id}."""
    try:
        req = urllib.request.Request(OSV_VULN_URL + vuln_id,
                                      headers={"Content-Type": "application/json"})
        resp = urllib.request.urlopen(req, timeout=10)
        return json.loads(resp.read())
    except Exception:
        return None


def _fetch_vulns_parallel(vuln_ids: list[str], max_workers: int = 15) -> dict[str, dict]:
    """Fetch full vuln details for a list of IDs in parallel. Returns {id: vuln_data}."""
    results: dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(_osv_fetch_vuln, vid): vid for vid in vuln_ids}
        for future in as_completed(futures):
            vid = futures[future]
            data = future.result()
            if data:
                results[vid] = data
    return results


def _cvss_vector_to_score(vector: str) -> float | None:
    """Approximate CVSS v3 base score from vector string."""
    # Simplified: use A/C/I impact and AV/AC exploitability
    try:
        parts = dict(p.split(":") for p in vector.split("/")[1:])
        weight = {"N": 0.0, "L": 0.22, "H": 0.56}
        c = weight.get(parts.get("C", "N"), 0)
        i = weight.get(parts.get("I", "N"), 0)
        a = weight.get(parts.get("A", "N"), 0)
        iscope = 1 - (1 - c) * (1 - i) * (1 - a)
        if iscope == 0:
            return 0.0
        impact = 7.52 * iscope - 3.25 * (iscope - 0.02) ** 15
        av_map = {"N": 0.85, "A": 0.62, "L": 0.55, "P": 0.2}
        ac_map = {"L": 0.77, "H": 0.44}
        pr_map = {"N": 0.85, "L": 0.62, "H": 0.27}
        ui_map = {"N": 0.85, "R": 0.62}
        exp = (8.22 * av_map.get(parts.get("AV", "N"), 0.85) *
               ac_map.get(parts.get("AC", "L"), 0.77) *
               pr_map.get(parts.get("PR", "N"), 0.85) *
               ui_map.get(parts.get("UI", "N"), 0.85))
        scope = parts.get("S", "U")
        if scope == "U":
            score = min(impact + exp, 10)
        else:
            score = min(1.08 * (impact + exp), 10)
        return round(max(score, 0), 1)
    except Exception:
        return None


def _format_vuln(pkg: str, version: str, ecosystem: str, vuln: dict) -> dict:
    severity = "UNKNOWN"
    cvss_score = None
    db = vuln.get("database_specific", {})

    # 1. GitHub Advisory Database includes severity string directly
    db_sev = str(db.get("severity", "")).upper()
    if db_sev in SEVERITY_ORDER:
        severity = db_sev

    # 2. CVSS vector or numeric score from severity list
    for sev in vuln.get("severity", []):
        sc = sev.get("score", "")
        if sc:
            if "/" in sc:
                computed = _cvss_vector_to_score(sc)
                if computed is not None:
                    cvss_score = computed
                    if severity == "UNKNOWN":
                        severity = _cvss_to_severity(cvss_score)
            else:
                try:
                    cvss_score = float(sc)
                    if severity == "UNKNOWN":
                        severity = _cvss_to_severity(cvss_score)
                except Exception:
                    pass

    # Extract CVE IDs — aliases is a list of ID strings, e.g. ["CVE-2023-1234", "GHSA-..."]
    aliases = vuln.get("aliases", [])
    cve_ids = [a for a in aliases if isinstance(a, str) and a.startswith("CVE-")]
    vuln_id = vuln.get("id", "")

    # Find fix version
    fix_versions = []
    for affected in vuln.get("affected", []):
        for rng in affected.get("ranges", []):
            for event in rng.get("events", []):
                if "fixed" in event:
                    fix_versions.append(event["fixed"])

    # References
    refs = [r.get("url", "") for r in vuln.get("references", [])[:3]]

    return {
        "id": vuln_id,
        "cve_ids": cve_ids,
        "package": pkg,
        "version": version,
        "ecosystem": ecosystem,
        "title": vuln.get("summary", vuln_id),
        "description": (vuln.get("details") or "")[:500],
        "severity": severity,
        "cvss_score": cvss_score,
        "fix_available": bool(fix_versions),
        "fix_versions": fix_versions[:3],
        "references": refs,
        "published": vuln.get("published", ""),
    }


# ── Parsers ────────────────────────────────────────────────────────────────────

def _parse_npm(path: Path) -> list[tuple[str, str]]:
    try:
        data = json.loads(path.read_text())
        pkgs = []
        for section in ("dependencies", "devDependencies", "peerDependencies"):
            for name, ver in data.get(section, {}).items():
                ver = re.sub(r"[^0-9.]", "", ver).strip(".") or "0.0.0"
                pkgs.append((name, ver))
        return pkgs
    except Exception:
        return []


def _parse_npm_lock(path: Path) -> list[tuple[str, str]]:
    """Parse package-lock.json for exact installed versions."""
    try:
        data = json.loads(path.read_text())
        pkgs = []
        for name, info in data.get("packages", {}).items():
            if name.startswith("node_modules/"):
                pkg_name = name[len("node_modules/"):]
                ver = info.get("version", "")
                if pkg_name and ver:
                    pkgs.append((pkg_name, ver))
        return pkgs or _parse_npm(path.parent / "package.json")
    except Exception:
        return []


def _parse_requirements(path: Path) -> list[tuple[str, str]]:
    pkgs = []
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or line.startswith("-"):
            continue
        m = re.match(r"^([A-Za-z0-9_\-\.]+)[>=<!~^]{0,2}=?([0-9][0-9a-z\.\-\+]*)?", line)
        if m:
            name = m.group(1)
            ver = m.group(2) or ""
            pkgs.append((name, ver))
    return pkgs


def _parse_pyproject(path: Path) -> list[tuple[str, str]]:
    pkgs = []
    try:
        import tomllib
    except ImportError:
        try:
            import tomli as tomllib  # type: ignore
        except ImportError:
            return pkgs
    try:
        data = tomllib.loads(path.read_text())
        deps = (data.get("project", {}).get("dependencies", []) or
                data.get("tool", {}).get("poetry", {}).get("dependencies", {}) or [])
        if isinstance(deps, list):
            for dep in deps:
                m = re.match(r"^([A-Za-z0-9_\-\.]+).*?([0-9][0-9a-z\.\-]*)?$", dep)
                if m:
                    pkgs.append((m.group(1), m.group(2) or ""))
        elif isinstance(deps, dict):
            for name, spec in deps.items():
                ver = re.search(r"([0-9][0-9a-z\.\-]*)", str(spec))
                pkgs.append((name, ver.group(1) if ver else ""))
    except Exception:
        pass
    return pkgs


def _parse_cargo_lock(path: Path) -> list[tuple[str, str]]:
    pkgs = []
    current: dict[str, str] = {}
    for line in path.read_text().splitlines():
        if line.startswith("[[package]]"):
            if current.get("name") and current.get("version"):
                pkgs.append((current["name"], current["version"]))
            current = {}
        m = re.match(r'^(name|version) = "(.+)"', line)
        if m:
            current[m.group(1)] = m.group(2)
    if current.get("name") and current.get("version"):
        pkgs.append((current["name"], current["version"]))
    return pkgs


def _parse_go_sum(path: Path) -> list[tuple[str, str]]:
    pkgs = []
    seen: set[str] = set()
    for line in path.read_text().splitlines():
        parts = line.split()
        if len(parts) >= 2:
            module = parts[0]
            version = parts[1].lstrip("v").split("/")[0]
            key = f"{module}@{version}"
            if key not in seen:
                seen.add(key)
                pkgs.append((module, version))
    return pkgs[:200]  # cap


# ── Discovery ─────────────────────────────────────────────────────────────────

def discover_manifests(path: str) -> dict[str, list[Path]]:
    root = Path(path)
    found: dict[str, list[Path]] = {}

    manifest_names = {
        "package-lock.json", "package.json",
        "requirements.txt", "requirements.in",
        "pyproject.toml", "Pipfile",
        "Cargo.lock",
        "go.sum",
        "Gemfile.lock",
        "pom.xml",
        "composer.lock",
    }

    skip_dirs = {"node_modules", ".git", ".venv", "venv", "__pycache__", ".tox",
                 "dist", "build", "target", ".next", ".nuxt"}

    for manifest in manifest_names:
        found[manifest] = []

    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in skip_dirs]
        for fname in filenames:
            if fname in manifest_names:
                found.setdefault(fname, []).append(Path(dirpath) / fname)

    return {k: v for k, v in found.items() if v}


def scan_dependencies(path: str) -> dict[str, Any]:
    """Scan all dependency files in a directory. Returns unified vulnerability report."""
    root = Path(path)
    if not root.exists():
        return {"error": f"Path not found: {path}"}

    manifests = discover_manifests(path)
    all_packages: list[tuple[str, str, str]] = []  # (name, version, ecosystem)
    detected_manifests: list[str] = []

    for fname, paths in manifests.items():
        for fpath in paths[:3]:  # max 3 of each type
            detected_manifests.append(str(fpath))
            if fname == "package-lock.json":
                pkgs = _parse_npm_lock(fpath)
                all_packages.extend((n, v, "npm") for n, v in pkgs if v)
            elif fname == "package.json":
                pkgs = _parse_npm(fpath)
                all_packages.extend((n, v, "npm") for n, v in pkgs if v)
            elif fname in ("requirements.txt", "requirements.in"):
                pkgs = _parse_requirements(fpath)
                all_packages.extend((n, v, "PyPI") for n, v in pkgs if v)
            elif fname == "pyproject.toml":
                pkgs = _parse_pyproject(fpath)
                all_packages.extend((n, v, "PyPI") for n, v in pkgs if v)
            elif fname == "Cargo.lock":
                pkgs = _parse_cargo_lock(fpath)
                all_packages.extend((n, v, "crates.io") for n, v in pkgs if v)
            elif fname == "go.sum":
                pkgs = _parse_go_sum(fpath)
                all_packages.extend((n, v, "Go") for n, v in pkgs if v)

    # Deduplicate
    seen_pkgs: set[tuple[str, str, str]] = set()
    unique_pkgs: list[tuple[str, str, str]] = []
    for p in all_packages:
        if p not in seen_pkgs:
            seen_pkgs.add(p)
            unique_pkgs.append(p)

    unique_pkgs = unique_pkgs[:500]  # cap at 500 packages per scan

    # OSV two-pass: batch query for vuln IDs → parallel fetch full details for severity
    vulns: list[dict] = []
    BATCH_SIZE = 50
    # Map vuln_id → (pkg, ver, eco) so we know which package triggered it
    id_to_pkg: dict[str, tuple[str, str, str]] = {}

    for i in range(0, len(unique_pkgs), BATCH_SIZE):
        batch = unique_pkgs[i:i + BATCH_SIZE]
        payload = {
            "queries": [
                {"package": {"name": name, "ecosystem": eco}, "version": ver}
                for name, ver, eco in batch
            ]
        }
        result = _osv_post(payload)
        results_list = result.get("results", [])
        for j, res in enumerate(results_list):
            if j >= len(batch):
                break
            name, ver, eco = batch[j]
            for v in res.get("vulns", []):
                vid = v.get("id", "")
                if vid and vid not in id_to_pkg:
                    id_to_pkg[vid] = (name, ver, eco)

    # Fetch full vuln details in parallel (batch API strips severity/CVSS)
    if id_to_pkg:
        full_vulns = _fetch_vulns_parallel(list(id_to_pkg.keys()))
        for vid, (pkg, ver, eco) in id_to_pkg.items():
            v = full_vulns.get(vid, {"id": vid})
            vulns.append(_format_vuln(pkg, ver, eco, v))

    # Also run pip-audit for Python projects (faster, more accurate)
    if any(f in manifests for f in ("requirements.txt", "pyproject.toml", "Pipfile")):
        try:
            req_file = manifests.get("requirements.txt", [])
            if req_file:
                out = subprocess.run(
                    ["pip-audit", "-r", str(req_file[0]), "--format", "json", "--progress-spinner", "off"],
                    capture_output=True, text=True, timeout=60,
                )
                if out.stdout:
                    audit_data = json.loads(out.stdout)
                    for dep in audit_data.get("dependencies", []):
                        for v in dep.get("vulns", []):
                            fix_vers = [f["fix_versions"] for f in [v] if v.get("fix_versions")]
                            existing = next((x for x in vulns if x["id"] == v["id"]), None)
                            if not existing:
                                vulns.append({
                                    "id": v["id"],
                                    "cve_ids": [v["id"]] if v["id"].startswith("CVE") else [],
                                    "package": dep.get("name", ""),
                                    "version": dep.get("version", ""),
                                    "ecosystem": "PyPI",
                                    "title": v.get("description", v["id"]),
                                    "description": v.get("description", ""),
                                    "severity": "UNKNOWN",
                                    "cvss_score": None,
                                    "fix_available": bool(v.get("fix_versions")),
                                    "fix_versions": v.get("fix_versions", []),
                                    "references": v.get("aliases", [])[:3],
                                    "published": "",
                                })
        except Exception as e:
            logger.warning("pip-audit failed", error=str(e))

    # Deduplicate vulns by id + package
    seen_vulns: set[tuple[str, str]] = set()
    unique_vulns: list[dict] = []
    for v in vulns:
        key = (v["id"], v["package"])
        if key not in seen_vulns:
            seen_vulns.add(key)
            unique_vulns.append(v)

    unique_vulns.sort(key=lambda x: SEVERITY_ORDER.get(x["severity"], 9))

    counts = {"CRITICAL": 0, "HIGH": 0, "MEDIUM": 0, "LOW": 0, "UNKNOWN": 0}
    for v in unique_vulns:
        counts[v["severity"]] = counts.get(v["severity"], 0) + 1

    return {
        "scan_type": "dependencies",
        "path": path,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "manifests_found": detected_manifests,
        "packages_scanned": len(unique_pkgs),
        "vulnerabilities": unique_vulns,
        "summary": {
            **counts,
            "total": len(unique_vulns),
            "fix_available": sum(1 for v in unique_vulns if v["fix_available"]),
        },
    }
