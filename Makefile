SHELL := /bin/sh

COMPOSE ?= docker compose
NPM ?= npm
API_SEED_COMMAND ?= dixora-seed

.PHONY: help bootstrap install build up dev down restart ps logs \
	config migrate seed test test-api test-node lint typecheck format check clean-volumes

help:
	@echo "Dixora development commands"
	@echo "  make bootstrap     Install JS dependencies and build containers"
	@echo "  make up            Start the complete local stack in the background"
	@echo "  make dev           Start the complete local stack with attached logs"
	@echo "  make down          Stop the local stack"
	@echo "  make logs          Follow service logs"
	@echo "  make migrate       Apply Alembic migrations"
	@echo "  make seed          Load development seed data"
	@echo "  make check         Run formatting, linting, type checking, and tests"
	@echo "  make clean-volumes Remove local containers and data volumes (destructive)"

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
