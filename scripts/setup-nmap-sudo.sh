#!/usr/bin/env bash
# One-time setup: allow Netindavoid to run nmap with sudo for OS detection and ARP scanning.
# Run once: bash scripts/setup-nmap-sudo.sh

set -e

NMAP_PATH="$(which nmap)"
USER="$(whoami)"

if [ -z "$NMAP_PATH" ]; then
  echo "Error: nmap not found. Install with: brew install nmap"
  exit 1
fi

SUDOERS_LINE="$USER ALL=(ALL) NOPASSWD: $NMAP_PATH"
SUDOERS_FILE="/etc/sudoers.d/netindavoid-nmap"

echo "Adding sudoers rule for nmap at $NMAP_PATH..."
echo "$SUDOERS_LINE" | sudo tee "$SUDOERS_FILE" > /dev/null
sudo chmod 440 "$SUDOERS_FILE"
echo "Done. nmap can now run with elevated privileges for OS detection."
echo "To remove: sudo rm $SUDOERS_FILE"
