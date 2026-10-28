.DEFAULT_GOAL := help

# Image and container naming
BACKEND_IMAGE ?= pitchmate-backend:latest
CLIENT_IMAGE ?= pitchmate-client:latest
BACKEND_CONTAINER ?= pitchmate-backend-standalone
CLIENT_CONTAINER ?= pitchmate-client-standalone

# Ports
BACKEND_PORT ?= 5243
CLIENT_PORT ?= 3000

# Dev auth signing key (must be >= 32 bytes)
AUTH_SIGNING_KEY ?= development-secret-key-that-is-at-least-32-bytes-long!

.PHONY: help build build-backend build-client run run-backend run-client stop stop-backend stop-client up down logs clean dev-backend dev-client

help: ## Show this help message
	@echo "PitchMate Management Makefile"
	@echo "Usage: make [target]"
	@echo ""
	@echo "Targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

## Dockerfile-specific build targets
build: build-backend build-client ## Build both backend and client Docker images by Dockerfile

build-backend: ## Build the backend Docker image using backend/Dockerfile
	docker build -f backend/Dockerfile -t $(BACKEND_IMAGE) .

build-client: ## Build the client web Docker image using apps/web/Dockerfile
	docker build -f apps/web/Dockerfile -t $(CLIENT_IMAGE) .

## Docker standalone container run targets
run: run-backend run-client ## Run both backend and client standalone containers

run-backend: ## Run backend container directly from built Dockerfile image
	@docker rm -f $(BACKEND_CONTAINER) 2>/dev/null || true
	docker run -d \
		--name $(BACKEND_CONTAINER) \
		-p $(BACKEND_PORT):5243 \
		-e ASPNETCORE_ENVIRONMENT=Development \
		-e Auth__Token__SigningKey="$(AUTH_SIGNING_KEY)" \
		-e Auth__Token__Issuer="http://localhost:5243" \
		-e Auth__Token__Audience="pitchmate-web" \
		$(BACKEND_IMAGE)
	@echo "Backend container running at http://localhost:$(BACKEND_PORT)"

run-client: ## Run client container directly from built Dockerfile image
	@docker rm -f $(CLIENT_CONTAINER) 2>/dev/null || true
	docker run -d \
		--name $(CLIENT_CONTAINER) \
		-p $(CLIENT_PORT):80 \
		$(CLIENT_IMAGE)
	@echo "Client container running at http://localhost:$(CLIENT_PORT)"

stop-backend: ## Stop standalone backend container
	@docker stop $(BACKEND_CONTAINER) 2>/dev/null || true
	@docker rm $(BACKEND_CONTAINER) 2>/dev/null || true

stop-client: ## Stop standalone client container
	@docker stop $(CLIENT_CONTAINER) 2>/dev/null || true
	@docker rm $(CLIENT_CONTAINER) 2>/dev/null || true

stop: stop-backend stop-client ## Stop all standalone containers

## Docker Compose orchestration targets (DB + Backend + Client)
up: ## Start all services (db, backend, client) via docker compose
	docker compose up --build -d

down: ## Stop all docker compose services and remove network
	docker compose down

logs: ## View logs of all docker compose services
	docker compose logs -f

clean: stop ## Stop standalone containers and compose services, and purge compose volumes
	docker compose down -v --remove-orphans

## Local native development shortcuts
dev-backend: ## Run backend locally with dotnet run
	dotnet run --project backend/src/PitchMate.Api

dev-client: ## Run web client locally with npm run dev
	npm run dev --workspace @pitchmate/web
