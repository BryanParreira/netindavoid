#!/bin/bash

# @raycast.schemaVersion 1
# @raycast.title Start Netindavoid
# @raycast.mode fullOutput
# @raycast.icon 🛡️
# @raycast.packageName Netindavoid
# @raycast.description Start Netindavoid and wait until fully healthy

APP_DIR="$HOME/Desktop/netindavoid"
API="http://localhost:8000/health"
WEB="http://localhost:3000"

cd "$APP_DIR" || { echo "❌ Project not found at $APP_DIR"; exit 1; }

echo "🚀 Starting Netindavoid..."
bash "$APP_DIR/scripts/start.sh"

# Wait for API
echo ""
echo "⏳ Confirming API is up..."
API_UP=false
for i in $(seq 1 20); do
  sleep 3
  STATUS=$(curl -sf -o /dev/null -w "%{http_code}" "$API" 2>/dev/null || echo "000")
  if [ "$STATUS" = "200" ]; then
    API_UP=true
    break
  fi
done

# Wait for frontend
WEB_UP=false
for i in $(seq 1 15); do
  sleep 2
  STATUS=$(curl -sf -o /dev/null -w "%{http_code}" "$WEB" 2>/dev/null || echo "000")
  if [ "$STATUS" = "200" ]; then
    WEB_UP=true
    break
  fi
done

echo ""
echo "─────────────────────────────────────"
if [ "$API_UP" = true ] && [ "$WEB_UP" = true ]; then
  echo "✅ Netindavoid is LIVE"
  open "$WEB"
elif [ "$API_UP" = true ]; then
  echo "⚠️  API up, frontend still warming up"
  open "$WEB"
else
  echo "❌ API did not respond — check /tmp/netindavoid-api.log"
fi
echo ""
echo "   Dashboard → http://localhost:3000"
echo "   API docs  → http://localhost:8000/docs"
echo "─────────────────────────────────────"
