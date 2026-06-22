#!/bin/bash

# @raycast.schemaVersion 1
# @raycast.title Stop Netindavoid
# @raycast.mode compact
# @raycast.icon 🔴
# @raycast.packageName Netindavoid
# @raycast.description Stop all Netindavoid services

APP_DIR="$HOME/Desktop/netindavoid"

bash "$APP_DIR/scripts/stop.sh"

echo "Netindavoid stopped"
