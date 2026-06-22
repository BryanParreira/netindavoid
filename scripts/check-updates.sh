#!/usr/bin/env bash
# Background poller: checks GitHub every 5 min, runs update.sh if new commits.
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$APP_DIR/logs/update.log"
mkdir -p "$APP_DIR/logs"

while true; do
  if git -C "$APP_DIR" rev-parse --git-dir &>/dev/null; then
    git -C "$APP_DIR" fetch origin main --quiet 2>/dev/null
    LOCAL=$(git -C "$APP_DIR" rev-parse HEAD 2>/dev/null)
    REMOTE=$(git -C "$APP_DIR" rev-parse origin/main 2>/dev/null)
    if [ "$LOCAL" != "$REMOTE" ]; then
      echo "[$(date '+%Y-%m-%d %H:%M:%S')] New version detected — updating..." >> "$LOG"
      bash "$APP_DIR/scripts/update.sh"
    fi
  fi
  sleep 300
done
