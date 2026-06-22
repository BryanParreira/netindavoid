#!/bin/bash

# @raycast.schemaVersion 1
# @raycast.title Restart Netindavoid
# @raycast.mode compact
# @raycast.icon 🔄
# @raycast.packageName Netindavoid
# @raycast.description Restart all Netindavoid services (keeps data)

APP_DIR="$HOME/Desktop/netindavoid"
DOCKER="/usr/local/bin/docker"

cd "$APP_DIR" || { echo "Project not found at $APP_DIR"; exit 1; }

"$DOCKER" compose restart 2>&1 | tail -3

echo "Netindavoid restarted → http://localhost:3000"
