#!/bin/bash
# Run once on each Mac to install the login-time autostart.
# Usage: ./scripts/install-autostart.sh

set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLIST_DST="$HOME/Library/LaunchAgents/com.netindavoid.autostart.plist"
SCRIPT="$APP_DIR/scripts/autostart.sh"

chmod +x "$SCRIPT"

cat > "$PLIST_DST" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.netindavoid.autostart</string>

  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$SCRIPT</string>
  </array>

  <!-- Run 30 seconds after login (gives Docker Desktop time to launch) -->
  <key>StartInterval</key>
  <integer>0</integer>

  <key>RunAtLoad</key>
  <true/>

  <!-- Retry if it exits non-zero -->
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>

  <key>StandardOutPath</key>
  <string>/tmp/netindavoid-autostart.log</string>

  <key>StandardErrorPath</key>
  <string>/tmp/netindavoid-autostart.log</string>

  <!-- Small delay so Docker Desktop has time to open first -->
  <key>ThrottleInterval</key>
  <integer>30</integer>
</dict>
</plist>
EOF

# Load it now (also activates on every future login automatically)
launchctl unload "$PLIST_DST" 2>/dev/null || true
launchctl load -w "$PLIST_DST"

echo ""
echo "✅ Autostart installed"
echo ""
echo "   Netindavoid will start automatically at every login."
echo "   Log: tail -f /tmp/netindavoid-autostart.log"
echo ""
echo "   ⚠️  Also do this ONE TIME in Docker Desktop:"
echo "   Docker icon → Settings → General → ✓ 'Start Docker Desktop when you log in'"
echo ""
echo "   To uninstall:"
echo "   launchctl unload ~/Library/LaunchAgents/com.netindavoid.autostart.plist"
echo "   rm ~/Library/LaunchAgents/com.netindavoid.autostart.plist"
