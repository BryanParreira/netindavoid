#!/usr/bin/env bash
# setup-local.sh — one-time local dev setup (no Docker required)
# Installs Homebrew deps, creates DB, sets up Python venv, installs JS deps.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API_DIR="$ROOT/apps/api"
WEB_DIR="$ROOT/apps/web"
VENV="$API_DIR/.venv"

cyan()  { echo "\033[0;36m$*\033[0m"; }
green() { echo "\033[0;32m$*\033[0m"; }
red()   { echo "\033[0;31m$*\033[0m"; }
bold()  { echo "\033[1m$*\033[0m"; }

bold "=== Netindavoid local setup ==="
echo ""

# ── 1. Homebrew ───────────────────────────────────────────────────────────────
if ! command -v brew &>/dev/null; then
  red "Homebrew not found. Install it first: https://brew.sh"
  exit 1
fi
cyan "Homebrew found."

# ── 2. System deps ────────────────────────────────────────────────────────────
cyan "Installing system dependencies via Homebrew..."
brew install postgresql@16 redis python@3.12 nmap 2>/dev/null || true
brew link --force postgresql@16 2>/dev/null || true
export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"

# ── 3. Start Postgres + Redis ────────────────────────────────────────────────
cyan "Starting PostgreSQL and Redis..."
brew services start postgresql@16
brew services start redis
sleep 2

# ── 4. Create database ────────────────────────────────────────────────────────
cyan "Creating database..."
createdb netindavoid 2>/dev/null || echo "  (database already exists)"
psql -d netindavoid -c "
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'netindavoid') THEN
      CREATE USER netindavoid WITH PASSWORD 'localdev';
    END IF;
  END
  \$\$;
  GRANT ALL PRIVILEGES ON DATABASE netindavoid TO netindavoid;
" 2>/dev/null || true

# ── 5. Python venv ────────────────────────────────────────────────────────────
cyan "Setting up Python virtual environment..."
if [ ! -d "$VENV" ]; then
  python3.12 -m venv "$VENV"
fi
source "$VENV/bin/activate"
pip install --upgrade pip -q
pip install -r "$API_DIR/requirements.txt" -q
green "Python venv ready."

# ── 6. Download OUI database ─────────────────────────────────────────────────
cyan "Downloading OUI (vendor) database..."
mkdir -p "$API_DIR/data"
if [ ! -f "$API_DIR/data/oui.txt" ]; then
  curl -sL "https://standards-oui.ieee.org/oui/oui.txt" -o "$API_DIR/data/oui.txt" && \
    green "OUI database downloaded." || \
    echo "  (OUI download failed — vendor names will be unavailable)"
else
  echo "  (OUI database already exists)"
fi

# ── 7. Initialise database tables ────────────────────────────────────────────
cyan "Initialising database schema..."
cd "$API_DIR"
python3 -c "
import asyncio, os
os.chdir('$API_DIR')
from core.database import init_db
asyncio.run(init_db())
print('Schema ready.')
"

# ── 8. Seed demo data ─────────────────────────────────────────────────────────
read -p "Seed demo data? (devices, traffic, alerts) [y/N] " SEED
if [[ "$SEED" =~ ^[Yy]$ ]]; then
  cyan "Seeding..."
  python3 -m scripts.seed
fi

# ── 9. JS deps ────────────────────────────────────────────────────────────────
cyan "Installing frontend dependencies..."
cd "$WEB_DIR"
npm install --legacy-peer-deps -q
green "Frontend deps ready."

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
green "=== Setup complete! ==="
echo ""
bold "Start the app:"
echo ""
echo "  Terminal 1 (API):"
echo "    cd $API_DIR"
echo "    source .venv/bin/activate"
echo "    uvicorn main:app --reload"
echo ""
echo "  Terminal 2 (Frontend — real API):"
echo "    cd $WEB_DIR"
echo "    NEXT_PUBLIC_USE_MOCK=false npm run dev"
echo ""
echo "  OR just frontend with mock data (no backend needed):"
echo "    cd $WEB_DIR && npm run dev"
echo ""
bold "Dashboard → http://localhost:3000"
bold "API docs  → http://localhost:8000/docs"
echo ""
