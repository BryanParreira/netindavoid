.PHONY: help dev dev-local dev-frontend stop seed logs

DOCKER_COMPOSE = docker compose
PYTHON         = python3
API_DIR        = apps/api
WEB_DIR        = apps/web
VENV           = $(API_DIR)/.venv

# ── Help ──────────────────────────────────────────────────────────────────────
help:
	@echo ""
	@echo "  Netindavoid — local development"
	@echo ""
	@echo "  make dev           Full stack via Docker Compose (requires Docker)"
	@echo "  make dev-local     Hybrid: Docker for DB+Redis, native API + frontend"
	@echo "  make dev-frontend  Frontend only — mock mode, no backend at all"
	@echo "  make seed          Seed demo data into the database"
	@echo "  make stop          Stop all running services"
	@echo "  make logs          Tail Docker Compose logs"
	@echo ""

# ── Full Docker stack ─────────────────────────────────────────────────────────
dev:
	@echo "Starting full stack via Docker Compose..."
	$(DOCKER_COMPOSE) up -d --build
	@echo ""
	@echo "  Dashboard → http://localhost:3000"
	@echo "  API docs  → http://localhost:8000/docs"
	@echo ""

# ── Hybrid: infra via Docker, API + web native ────────────────────────────────
dev-local: _check-homebrew _setup-venv _start-infra _seed-local
	@echo ""
	@echo "Infra (postgres + redis) is running via Docker."
	@echo ""
	@echo "  Open two more terminals and run:"
	@echo ""
	@echo "    Terminal 2:  make _run-api"
	@echo "    Terminal 3:  make _run-web"
	@echo ""
	@echo "  Or run both with:  make _run-api & make _run-web"
	@echo ""

_run-api:
	@echo "Starting FastAPI on :8000..."
	cd $(API_DIR) && . .venv/bin/activate && uvicorn main:app --reload --host 0.0.0.0 --port 8000

_run-web:
	@echo "Starting Next.js on :3000 (real API mode)..."
	cd $(WEB_DIR) && NEXT_PUBLIC_USE_MOCK=false npm run dev

# ── Frontend only (mock mode) ─────────────────────────────────────────────────
dev-frontend:
	@echo "Starting frontend in mock mode — no backend needed..."
	cd $(WEB_DIR) && npm run dev

# ── Seed demo data ────────────────────────────────────────────────────────────
seed:
	@echo "Seeding demo data..."
	cd $(API_DIR) && . .venv/bin/activate && $(PYTHON) -m scripts.seed

# ── Stop everything ───────────────────────────────────────────────────────────
stop:
	$(DOCKER_COMPOSE) down 2>/dev/null || true
	$(DOCKER_COMPOSE) -f docker-compose.infra.yml down 2>/dev/null || true
	@pkill -f "uvicorn main:app" 2>/dev/null || true
	@pkill -f "next dev"         2>/dev/null || true
	@echo "All services stopped."

# ── Logs ──────────────────────────────────────────────────────────────────────
logs:
	$(DOCKER_COMPOSE) logs -f

# ── Internal targets ──────────────────────────────────────────────────────────
_check-homebrew:
	@which brew > /dev/null || (echo "ERROR: Homebrew not installed. Visit https://brew.sh" && exit 1)
	@which docker > /dev/null || (echo "ERROR: Docker not installed. Run: brew install --cask docker" && exit 1)

_setup-venv:
	@if [ ! -d "$(VENV)" ]; then \
		echo "Creating Python venv..."; \
		$(PYTHON) -m venv $(VENV); \
		$(VENV)/bin/pip install --upgrade pip -q; \
		$(VENV)/bin/pip install -r $(API_DIR)/requirements.txt -q; \
		echo "Venv ready."; \
	else \
		echo "Venv already exists, skipping."; \
	fi

_start-infra:
	@echo "Starting postgres + redis via Docker..."
	$(DOCKER_COMPOSE) -f docker-compose.infra.yml up -d
	@echo "Waiting for postgres to be healthy..."
	@for i in $$(seq 1 20); do \
		docker compose -f docker-compose.infra.yml exec -T postgres pg_isready -U netindavoid -d netindavoid > /dev/null 2>&1 && break; \
		echo "  waiting... ($$i/20)"; sleep 2; \
	done

_seed-local:
	@echo "Initialising database (first run only)..."
	cd $(API_DIR) && . .venv/bin/activate && \
		$(PYTHON) -c "import asyncio; from core.database import init_db; asyncio.run(init_db())" 2>/dev/null || true
