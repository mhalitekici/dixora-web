SHELL := /bin/sh

COMPOSE ?= docker compose
NPM ?= npm
API_SEED_COMMAND ?= dixora-seed

PROD_COMPOSE ?= docker compose -f docker-compose.prod.yml --env-file .env.production

.PHONY: help bootstrap install build up dev down restart ps logs \
	config migrate seed demo test test-api test-node lint typecheck format check clean-volumes \
	prod-config prod-up prod-ps prod-logs prod-migrate prod-backup

help:
	@echo "Dixora development commands"
	@echo "  make bootstrap     Install JS dependencies and build containers"
	@echo "  make up            Start the complete local stack in the background"
	@echo "  make dev           Start the complete local stack with attached logs"
	@echo "  make down          Stop the local stack"
	@echo "  make logs          Follow service logs"
	@echo "  make migrate       Apply Alembic migrations"
	@echo "  make seed          Load development seed data"
	@echo "  make demo          Rebuild the Meydan Restaurant demo business"
	@echo "  make check         Run formatting, linting, type checking, and tests"
	@echo "  make clean-volumes Remove local containers and data volumes (destructive)"
	@echo ""
	@echo "Production (needs .env.production; see docs/hetzner-production-deploy.md)"
	@echo "  make prod-config   Validate the production Compose file"
	@echo "  make prod-up       Build and start the production stack"
	@echo "  make prod-ps       Show production service health"
	@echo "  make prod-logs     Follow production logs"
	@echo "  make prod-migrate  Show the applied migration revision"
	@echo "  make prod-backup   Take a verified database dump"

bootstrap: install config build

install:
	$(NPM) install

build:
	$(COMPOSE) build

config:
	$(COMPOSE) config --quiet

up:
	$(COMPOSE) up --build --detach

dev:
	$(COMPOSE) up --build

down:
	$(COMPOSE) down

restart: down up

ps:
	$(COMPOSE) ps

logs:
	$(COMPOSE) logs --follow --tail=200

migrate:
	$(COMPOSE) run --rm api alembic upgrade head

seed:
	$(COMPOSE) run --rm api $(API_SEED_COMMAND)

demo:
	$(COMPOSE) run --rm api python -m app.demo --reset

test: test-node test-api

test-node:
	$(NPM) test

test-api:
	$(COMPOSE) run --rm api pytest

lint:
	$(NPM) run lint
	$(COMPOSE) run --rm api ruff check .

typecheck:
	$(NPM) run typecheck
	$(COMPOSE) run --rm api mypy app

format:
	$(NPM) run format
	$(COMPOSE) run --rm api ruff format .

check:
	$(NPM) run check
	$(COMPOSE) run --rm api ruff check .
	$(COMPOSE) run --rm api mypy app
	$(COMPOSE) run --rm api pytest

clean-volumes:
	@echo "This permanently removes local PostgreSQL, Redis, and MinIO data."
	$(COMPOSE) down --volumes --remove-orphans

# --- production ------------------------------------------------------------
# Every target refuses to guess: .env.production must exist and is never
# committed. See docs/hetzner-production-deploy.md.

prod-config:
	$(PROD_COMPOSE) config --quiet

prod-up:
	$(PROD_COMPOSE) up --build --detach

prod-ps:
	$(PROD_COMPOSE) ps

prod-logs:
	$(PROD_COMPOSE) logs --follow --tail=200

prod-migrate:
	$(PROD_COMPOSE) exec -T api alembic current

prod-backup:
	COMPOSE_FILE=docker-compose.prod.yml ./ops/backup.sh
