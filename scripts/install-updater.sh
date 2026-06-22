#!/usr/bin/env bash
# Install the auto-updater LaunchAgent.
set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLIST_DEST="$HOME/Library/LaunchAgents/com.netindavoid.updater.plist"

# Inject real APP_DIR into plist
sed "s|PLACEHOLDER_APP_DIR|$APP_DIR|g" \
    "$APP_DIR/scripts/com.netindavoid.updater.plist" > "$PLIST_DEST"

launchctl unload -w "$PLIST_DEST" 2>/dev/null || true
launchctl load -w "$PLIST_DEST"

echo "✓ Auto-updater installed. Checks GitHub every 5 minutes."
echo "  Logs: $APP_DIR/logs/updater.log"
