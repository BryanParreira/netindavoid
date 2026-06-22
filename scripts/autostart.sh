#!/bin/bash
# Runs at login via LaunchAgent — waits for Docker, then ensures containers are up.
# Logs to /tmp/netindavoid-autostart.log

LOG="/tmp/netindavoid-autostart.log"
APP_DIR="$HOME/Desktop/netindavoid"
DOCKER="/usr/local/bin/docker"

log() { echo "[$(date '+%H:%M:%S')] $*" >> "$LOG"; }

log "=== Netindavoid autostart ==="

# Wait for Docker Desktop (up to 3 min)
for i in $(seq 1 45); do
  if "$DOCKER" info > /dev/null 2>&1; then
    log "Docker ready after ${i}x4s"
    break
  fi
  if [ "$i" -eq 45 ]; then
    log "ERROR: Docker never started — giving up"
    exit 1
  fi
  sleep 4
done

cd "$APP_DIR" || { log "ERROR: project not found at $APP_DIR"; exit 1; }

"$DOCKER" compose up -d >> "$LOG" 2>&1
log "docker compose up -d exit=$?"

# Verify API is reachable
for i in $(seq 1 30); do
  sleep 4
  STATUS=$(curl -sf -o /dev/null -w "%{http_code}" http://localhost:8000/health 2>/dev/null || echo "000")
  if [ "$STATUS" = "200" ]; then
    log "API healthy ✓"
    exit 0
  fi
done

log "WARNING: API did not respond after 2min — check 'docker compose logs api'"
