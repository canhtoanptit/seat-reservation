# Seat Reservation — common commands.
#
# Two workflows:
#   • Docker:  `make up`             builds and runs postgres + app in compose
#   • Local:   `make dev`            runs postgres in compose, app on the host
#
# Run `make help` for the full list.

.DEFAULT_GOAL := help
SHELL := /bin/bash

# ── meta ──────────────────────────────────────────────────────────────────────

.PHONY: help
help: ## show this help
	@awk 'BEGIN{FS=":.*##"; printf "Targets:\n"} /^[a-zA-Z0-9_.-]+:.*##/{printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# ── one-shot demo ─────────────────────────────────────────────────────────────

.PHONY: demo
demo: up ## one-shot: build + run the whole stack, then print the URL
	@echo
	@echo "  → Open http://localhost:3000"
	@echo "  → Tail logs with: make logs"
	@echo

# ── docker compose ────────────────────────────────────────────────────────────

.PHONY: up
up: ## build images if needed, start postgres + app in the background
	docker compose up -d --build

.PHONY: down
down: ## stop everything (data persists)
	docker compose down

.PHONY: clean
clean: ## stop everything and wipe the DB volume
	docker compose down -v

.PHONY: rebuild
rebuild: ## rebuild the app image from scratch
	docker compose build --no-cache app

.PHONY: logs
logs: ## tail app logs
	docker compose logs -f app

.PHONY: logs-db
logs-db: ## tail postgres logs
	docker compose logs -f postgres

.PHONY: ps
ps: ## show running services
	docker compose ps

.PHONY: shell
shell: ## open a shell in the running app container
	docker compose exec app sh

.PHONY: psql
psql: ## open psql against the running postgres
	docker compose exec postgres psql -U app -d seat_reservation

# ── local dev (host runs the app; compose runs postgres only) ────────────────

.PHONY: dev
dev: db-up ## run the app on the host with hot reload; postgres in compose
	pnpm dev

.PHONY: db-up
db-up: ## start only the postgres service
	docker compose up -d postgres

.PHONY: db-down
db-down: ## stop only the postgres service
	docker compose stop postgres

# ── database ──────────────────────────────────────────────────────────────────

.PHONY: migrate
migrate: ## apply pending migrations against the local DB
	pnpm db:migrate

.PHONY: seed
seed: ## insert the 3 seats (idempotent)
	pnpm db:seed

.PHONY: reset
reset: ## drop + recreate + migrate + seed (DEV ONLY)
	pnpm db:reset

.PHONY: sweep
sweep: ## expire stale holds + flag stuck-paying for operator review
	pnpm sweep

# ── tests + quality ───────────────────────────────────────────────────────────

.PHONY: test
test: ## run unit + integration tests (requires postgres up)
	pnpm test

.PHONY: test-marquee
test-marquee: ## just the concurrent-hold marquee test
	pnpm test tests/integration/concurrent-hold.test.ts

.PHONY: test-e2e
test-e2e: ## run the Playwright happy-path (boots dev server)
	pnpm test:e2e

.PHONY: typecheck
typecheck: ## tsc --noEmit
	pnpm typecheck

.PHONY: lint
lint: ## eslint
	pnpm lint

.PHONY: check
check: typecheck lint test ## fast pre-PR sweep: types + lint + tests

# ── install ───────────────────────────────────────────────────────────────────

.PHONY: install
install: ## pnpm install
	pnpm install
