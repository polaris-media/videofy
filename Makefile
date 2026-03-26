.PHONY: help sync sync-hotspot install dev dev-api dev-cms stop-dev start-server stop-server restart-server status-server test test-api test-cms test-live-download audit

.DEFAULT_GOAL := help

HOTSPOT ?= 0
UV_SYNC_GROUP_ARGS :=
UV_BIN := $(shell if command -v uv >/dev/null 2>&1; then printf '%s' uv; elif command -v python3 >/dev/null 2>&1; then printf '%s' "python3 -m uv"; elif command -v python >/dev/null 2>&1; then printf '%s' "python -m uv"; fi)
API_PORT ?= 8001
CMS_PORT ?= 3000
HOST ?= 0.0.0.0
API_BASE_URL ?= http://127.0.0.1:$(API_PORT)
CMS_BASE_URL ?= http://127.0.0.1:$(CMS_PORT)
LOG_DIR ?= /tmp/videofy

ifeq ($(HOTSPOT),1)
UV_SYNC_GROUP_ARGS += --group hotspot
endif

help:
	@echo "Videofy Minimal - Make commands"
	@echo ""
	@echo "Usage:"
	@echo "  make <target> [VAR=value]"
	@echo ""
	@echo "Targets:"
	@echo "  help         Show this help output"
	@echo "  sync         Install Python dependencies (HOTSPOT=1 includes hotspot deps)"
	@echo "  sync-hotspot Install only hotspot Python dependency group"
	@echo "  install      Install npm dependencies"
	@echo "  dev-api      Start API server on :8001"
	@echo "  dev-cms      Start CMS dev server on :3000"
	@echo "  dev          Start API + CMS together"
	@echo "  stop-dev     Stop local listeners on ports 8001 and 3000"
	@echo "  start-server Start API + CMS in background with matching env vars"
	@echo "  stop-server  Stop background API + CMS listeners on API_PORT and CMS_PORT"
	@echo "  restart-server Stop + start background API + CMS listeners"
	@echo "  status-server Show listeners, logs, and health for the configured ports"
	@echo "  test-api     Run Python tests"
	@echo "  test-cms     Run CMS typecheck and build"
	@echo "  test-live-download Run opt-in live CMS vertical download regression test"
	@echo "  test         Run all tests"
	@echo "  audit        Run npm audit (critical)"
	@echo ""
	@echo "Options:"
	@echo "  HOTSPOT=1                  Include hotspot dependencies in sync/dev"
	@echo "  API_PORT=8002              Override the data API port for background server targets"
	@echo "  CMS_PORT=3000              Override the CMS port for background server targets"
	@echo ""
	@echo "Examples:"
	@echo "  make dev"
	@echo "  make dev HOTSPOT=1"
	@echo "  make restart-server API_PORT=8002"

sync:
	$(UV_BIN) sync $(UV_SYNC_GROUP_ARGS)

sync-hotspot:
	$(UV_BIN) sync --group hotspot

install:
	npm install

dev-api: sync
	$(UV_BIN) run uvicorn api.main:app --reload --host 0.0.0.0 --port 8001

dev-cms: install
	npm run dev:cms

dev: sync install
	@set -e; \
	trap 'kill $$api_pid $$cms_pid 2>/dev/null || true' EXIT INT TERM; \
	if lsof -ti tcp:8001 -sTCP:LISTEN >/dev/null 2>&1; then \
		api_existing_pid=$$(lsof -ti tcp:8001 -sTCP:LISTEN | head -n1); \
		echo "Error: API port 8001 is already in use by pid=$$api_existing_pid."; \
		echo "Run 'make stop-dev' to clear stale local dev processes."; \
		exit 1; \
	else \
		$(UV_BIN) run uvicorn api.main:app --reload --host 0.0.0.0 --port 8001 & \
		api_pid=$$!; \
	fi; \
	if lsof -ti tcp:3000 -sTCP:LISTEN >/dev/null 2>&1; then \
		cms_existing_pid=$$(lsof -ti tcp:3000 -sTCP:LISTEN | head -n1); \
		echo "Error: CMS port 3000 is already in use by pid=$$cms_existing_pid."; \
		echo "Run 'make stop-dev' to clear stale local dev processes."; \
		exit 1; \
	fi; \
	npm run dev:cms & \
	cms_pid=$$!; \
	wait $$api_pid $$cms_pid

stop-dev:
	@api_pids=$$(lsof -ti tcp:8001 -sTCP:LISTEN 2>/dev/null || true); \
	cms_pids=$$(lsof -ti tcp:3000 -sTCP:LISTEN 2>/dev/null || true); \
	if [ -n "$$api_pids" ]; then \
		echo "Stopping API listener(s) on 8001: $$api_pids"; \
		kill $$api_pids 2>/dev/null || true; \
	else \
		echo "No API listener on 8001"; \
	fi; \
	if [ -n "$$cms_pids" ]; then \
		echo "Stopping CMS listener(s) on 3000: $$cms_pids"; \
		kill $$cms_pids 2>/dev/null || true; \
	else \
		echo "No CMS listener on 3000"; \
	fi

start-server:
	@set -e; \
	mkdir -p "$(LOG_DIR)"; \
	api_pids=$$(lsof -ti tcp:$(API_PORT) -sTCP:LISTEN 2>/dev/null || true); \
	cms_pids=$$(lsof -ti tcp:$(CMS_PORT) -sTCP:LISTEN 2>/dev/null || true); \
	if [ -n "$$api_pids" ]; then \
		echo "Error: API port $(API_PORT) is already in use by pid(s): $$api_pids"; \
		exit 1; \
	fi; \
	if [ -n "$$cms_pids" ]; then \
		echo "Error: CMS port $(CMS_PORT) is already in use by pid(s): $$cms_pids"; \
		exit 1; \
	fi; \
	nohup env APP_BASE_URL="$(API_BASE_URL)" \
		$(UV_BIN) run uvicorn api.main:app --host "$(HOST)" --port "$(API_PORT)" \
		>"$(LOG_DIR)/api-$(API_PORT).log" 2>&1 </dev/null & \
	api_pid=$$!; \
	echo "Started API pid=$$api_pid log=$(LOG_DIR)/api-$(API_PORT).log"; \
	for attempt in 1 2 3 4 5 6 7 8 9 10; do \
		if curl -fsS "$(API_BASE_URL)/health" >/dev/null 2>&1; then \
			break; \
		fi; \
		sleep 1; \
		if [ $$attempt -eq 10 ]; then \
			echo "API did not become healthy on $(API_BASE_URL). See $(LOG_DIR)/api-$(API_PORT).log"; \
			exit 1; \
		fi; \
	done; \
	nohup env MINIMAL_DATA_API_URL="$(API_BASE_URL)" \
		MINIMAL_FILE_BASE_URL="$(API_BASE_URL)" \
		NEXT_PUBLIC_CMS_BASE_URL="$(CMS_BASE_URL)" \
		npm run start -w @videofy/cms -- --hostname "$(HOST)" --port "$(CMS_PORT)" \
		>"$(LOG_DIR)/cms-$(CMS_PORT).log" 2>&1 </dev/null & \
	cms_pid=$$!; \
	echo "Started CMS pid=$$cms_pid log=$(LOG_DIR)/cms-$(CMS_PORT).log"

stop-server:
	@api_pids=$$(lsof -ti tcp:$(API_PORT) -sTCP:LISTEN 2>/dev/null || true); \
	cms_pids=$$(lsof -ti tcp:$(CMS_PORT) -sTCP:LISTEN 2>/dev/null || true); \
	if [ -n "$$api_pids" ]; then \
		echo "Stopping API listener(s) on $(API_PORT): $$api_pids"; \
		kill $$api_pids 2>/dev/null || true; \
	else \
		echo "No API listener on $(API_PORT)"; \
	fi; \
	if [ -n "$$cms_pids" ]; then \
		echo "Stopping CMS listener(s) on $(CMS_PORT): $$cms_pids"; \
		kill $$cms_pids 2>/dev/null || true; \
	else \
		echo "No CMS listener on $(CMS_PORT)"; \
	fi

restart-server: stop-server start-server

status-server:
	@echo "API port: $(API_PORT)"; \
	lsof -iTCP:$(API_PORT) -sTCP:LISTEN -P -n 2>/dev/null || echo "No API listener on $(API_PORT)"; \
	echo ""; \
	echo "CMS port: $(CMS_PORT)"; \
	lsof -iTCP:$(CMS_PORT) -sTCP:LISTEN -P -n 2>/dev/null || echo "No CMS listener on $(CMS_PORT)"; \
	echo ""; \
	echo "API health:"; \
	curl -fsS "$(API_BASE_URL)/health" || echo "API health check failed"; \
	echo ""; \
	echo "CMS fetchers:"; \
	curl -fsS "$(CMS_BASE_URL)/api/fetchers" || echo "CMS fetchers check failed"; \
	echo ""; \
	echo "Recent API log:"; \
	tail -n 20 "$(LOG_DIR)/api-$(API_PORT).log" 2>/dev/null || echo "No API log found"; \
	echo ""; \
	echo "Recent CMS log:"; \
	tail -n 20 "$(LOG_DIR)/cms-$(CMS_PORT).log" 2>/dev/null || echo "No CMS log found"

test-api: sync
	$(UV_BIN) run pytest -q

test-cms: install
	npm run check-types:cms
	npm run build:cms

test-live-download: sync
	$(UV_BIN) run pytest -q tests/test_live_cms_vertical_download.py

test: test-api test-cms

audit: install
	npm audit --audit-level=critical
