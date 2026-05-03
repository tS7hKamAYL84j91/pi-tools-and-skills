# pi-tools-and-skills — common tasks

SHELL := /bin/bash
.DEFAULT_GOAL := help

ROOT_DIR := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))
NPM ?= npm

.PHONY: help check typecheck lint knip type-coverage test test-watch clean-mailboxes

help: ## Show available make targets
	@awk 'BEGIN {FS = ":.*## "; printf "Usage:\n  make <target>\n\nTargets:\n"} /^[a-zA-Z0-9_.-]+:.*## / {printf "  %-18s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

check: ## Run typecheck, lint, knip, and type-coverage
	$(NPM) run check

typecheck: ## Run TypeScript typecheck
	$(NPM) run typecheck

lint: ## Run Biome lint
	$(NPM) run lint

knip: ## Check for unused files, exports, and dependencies
	$(NPM) run knip

type-coverage: ## Check TypeScript type coverage
	$(NPM) run type-coverage

test: ## Run tests
	$(NPM) test

test-watch: ## Run tests in watch mode
	$(NPM) run test:watch

clean-mailboxes: ## Clean stale agent mailboxes
	$(ROOT_DIR)scripts/clean-mailboxes

