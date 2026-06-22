#!/bin/bash
# Sets up sudoers for tcpdump so Netindavoid can do WiFi intelligence scanning.
# Run this ONCE in Terminal: bash scripts/setup-wifi-intel.sh
set -e

TCPDUMP=$(which tcpdump)
USERNAME=$(whoami)

echo "[netindavoid] Setting up WiFi intelligence tools..."
echo "  tcpdump: $TCPDUMP"
echo "  user: $USERNAME"
echo ""

SUDOERS_FILE="/etc/sudoers.d/netindavoid-tcpdump"
RULE="$USERNAME ALL=(ALL) NOPASSWD: $TCPDUMP"

echo "$RULE" | sudo tee "$SUDOERS_FILE" > /dev/null
sudo chmod 440 "$SUDOERS_FILE"

echo "[ok] Sudoers rule written: $SUDOERS_FILE"

# Verify
if sudo -n tcpdump --version > /dev/null 2>&1; then
    echo "[ok] tcpdump runs without password — WiFi intel ready."
else
    echo "[error] tcpdump still needs password. Check $SUDOERS_FILE"
    exit 1
fi

echo ""
echo "Done. Restart the API for changes to take effect."
