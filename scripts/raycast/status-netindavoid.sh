#!/bin/bash

# @raycast.schemaVersion 1
# @raycast.title Netindavoid Status
# @raycast.mode fullOutput
# @raycast.icon 📡
# @raycast.packageName Netindavoid
# @raycast.description Check which Netindavoid services are running

check() {
  local name="$1" url="$2"
  local code
  code=$(curl -sf -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || echo "000")
  if [ "$code" = "200" ]; then
    echo "✅  $name → $url"
  else
    echo "🔴  $name (not responding)"
  fi
}

echo "─── Netindavoid Service Status ───"
echo ""
check "API      " "http://localhost:8000/health"
check "Frontend " "http://localhost:3000"

echo ""
echo "─── Processes ────────────────────"
pgrep -fl "uvicorn main:app"  | head -2 | sed 's/^/  🐍  /' || echo "  🔴  FastAPI not running"
pgrep -fl "next dev"          | head -2 | sed 's/^/  ⚡  /' || echo "  🔴  Next.js not running"
pgrep -fl "celery.*worker"    | head -1 | sed 's/^/  ⚙️   /' || echo "  🔴  Celery not running"

echo ""
echo "─── Logs ─────────────────────────"
echo "  API:    tail -f /tmp/netindavoid-api.log"
echo "  Worker: tail -f /tmp/netindavoid-celery.log"
echo "  Web:    tail -f /tmp/netindavoid-web.log"
