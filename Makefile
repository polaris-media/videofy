.PHONY: help sync sync-hotspot install dev dev-api dev-cms stop-dev test test-api test-cms test-live-download audit

.DEFAULT_GOAL := help

HOTSPOT ?= 0
UV_SYNC_GROUP_ARGS :=
UV_BIN := $(shell if command -v uv >/dev/null 2>&1; then printf '%s' uv; elif command -v python3 >/dev/null 2>&1; then printf '%s' "python3 -m uv"; elif command -v python >/dev/null 2>&1; then printf '%s' "python -m uv"; fi)

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
	@echo "  test-api     Run Python tests"
	@echo "  test-cms     Run CMS typecheck and build"
	@echo "  test-live-download Run opt-in live CMS vertical download regression test"
	@echo "  test         Run all tests"
	@echo "  audit        Run npm audit (critical)"
	@echo ""
	@echo "Options:"
	@echo "  HOTSPOT=1                  Include hotspot dependencies in sync/dev"
	@echo ""
	@echo "Examples:"
	@echo "  make dev"
	@echo "  make dev HOTSPOT=1"

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
