#!/usr/bin/env bash
# start.sh — start all Netindavoid services
# Run from anywhere: ./scripts/start.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API_DIR="$ROOT/apps/api"
WEB_DIR="$ROOT/apps/web"

green() { echo "\033[0;32m$*\033[0m"; }
cyan()  { echo "\033[0;36m$*\033[0m"; }
yellow(){ echo "\033[0;33m$*\033[0m"; }

# ── Postgres + Redis ──────────────────────────────────────────────────────────
cyan "Starting Postgres + Redis..."
brew services start postgresql@16 2>/dev/null || true
brew services start redis           2>/dev/null || true

# ── Ollama (uses external drive if mounted, otherwise skip) ───────────────────
pkill -f "ollama serve" 2>/dev/null || true
sleep 1

OLLAMA_DATA="/Volumes/Davoid/ollama/.ollama"
if [ -d "$OLLAMA_DATA" ]; then
  cyan "External drive found — starting Ollama with models from $OLLAMA_DATA"
  OLLAMA_HOME="$OLLAMA_DATA" ollama serve > /tmp/ollama.log 2>&1 &
  sleep 3
  if curl -s http://localhost:11434/ > /dev/null 2>&1; then
    green "Ollama running with external models"
  else
    yellow "Ollama failed to start — check /tmp/ollama.log"
  fi
else
  yellow "External drive not mounted — Ollama skipped (plug in Davoid drive and re-run to enable AI)"
fi

# ── FastAPI ───────────────────────────────────────────────────────────────────
pkill -f "uvicorn main:app" 2>/dev/null || true
sleep 1
cyan "Starting FastAPI..."
cd "$API_DIR"
PYTHONPATH="$API_DIR" .venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000 > /tmp/netindavoid-api.log 2>&1 &
sleep 6
if curl -s http://localhost:8000/health | grep -q "healthy"; then
  green "API running → http://localhost:8000"
else
  echo "API log tail:"; tail -5 /tmp/netindavoid-api.log
fi

# ── Celery worker ─────────────────────────────────────────────────────────────
pkill -f "celery.*worker" 2>/dev/null || true
sleep 1
cyan "Starting Celery worker + beat scheduler..."
cd "$API_DIR"
PYTHONPATH="$API_DIR" .venv/bin/celery -A workers.celery_app worker \
  --loglevel=warning --concurrency=2 > /tmp/netindavoid-celery.log 2>&1 &
PYTHONPATH="$API_DIR" .venv/bin/celery -A workers.celery_app beat \
  --loglevel=warning > /tmp/netindavoid-beat.log 2>&1 &
sleep 3
if grep -q "celery@" /tmp/netindavoid-celery.log 2>/dev/null; then
  green "Celery worker + beat running (traffic/DNS every 30s, scan every 60s)"
else
  yellow "Celery may have failed — check /tmp/netindavoid-celery.log"
fi

# ── Next.js frontend ──────────────────────────────────────────────────────────
pkill -f "next dev" 2>/dev/null || true
sleep 1
cyan "Starting frontend..."
cd "$WEB_DIR"
npm run dev > /tmp/netindavoid-web.log 2>&1 &
sleep 10
PORT=$(grep "Local:" /tmp/netindavoid-web.log | grep -oE ':[0-9]+' | head -1 | tr -d ':')
green "Frontend running → http://localhost:${PORT:-3000}"

echo ""
green "=== All services started ==="
echo ""
echo "  Dashboard  → http://localhost:${PORT:-3000}"
echo "  API docs   → http://localhost:8000/docs"
echo "  API log    → tail -f /tmp/netindavoid-api.log"
echo "  Worker log → tail -f /tmp/netindavoid-celery.log"
echo ""
echo "  To stop everything: ./scripts/stop.sh"
echo ""
