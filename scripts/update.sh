#!/usr/bin/env bash
# Auto-update: pulls latest from GitHub, rebuilds, restarts services.
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$APP_DIR/logs/update.log"
mkdir -p "$APP_DIR/logs"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"; }

log "=== Netindavoid update started ==="

cd "$APP_DIR"

if ! git rev-parse --git-dir &>/dev/null; then
  log "ERROR: Not a git repository. Run: git init && git remote add origin <your-github-url>"
  exit 1
fi

BEFORE=$(git rev-parse HEAD 2>/dev/null || echo "none")
log "Current commit: $BEFORE"

git fetch origin main 2>&1 | tee -a "$LOG"
AFTER=$(git rev-parse origin/main 2>/dev/null || echo "none")

if [ "$BEFORE" = "$AFTER" ]; then
  log "Already up to date."
  exit 0
fi

log "New commit: $AFTER — pulling..."
git pull origin main 2>&1 | tee -a "$LOG"

WEB_CHANGED=false
API_CHANGED=false

if git diff --name-only "$BEFORE" "$AFTER" | grep -q "^apps/web/"; then
  WEB_CHANGED=true
fi
if git diff --name-only "$BEFORE" "$AFTER" | grep -q "^apps/api/"; then
  API_CHANGED=true
fi

# Rebuild + restart frontend
if $WEB_CHANGED; then
  log "Frontend changed — rebuilding..."
  cd "$APP_DIR/apps/web"
  npm install --legacy-peer-deps 2>&1 | tail -5 | tee -a "$LOG"
  pkill -f "next" 2>/dev/null || true
  sleep 1
  nohup npm run dev >> "$LOG" 2>&1 &
  log "Frontend rebuilt and restarted."
  cd "$APP_DIR"
elif pgrep -f "next dev" &>/dev/null; then
  # Even if web didn't change, ensure frontend stays running
  :
fi

# Restart API
if $API_CHANGED; then
  log "API changed — restarting..."
  pkill -f "uvicorn" 2>/dev/null || true
  sleep 2
  cd "$APP_DIR/apps/api"
  source "$APP_DIR/apps/api/.venv/bin/activate"
  nohup uvicorn main:app --host 0.0.0.0 --port 8000 >> "$LOG" 2>&1 &
  log "API restarted."
  cd "$APP_DIR"
fi

log "Update complete: $BEFORE → $AFTER"
