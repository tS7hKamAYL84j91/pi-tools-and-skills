# pi-tools-and-skills — common tasks

SHELL := /bin/bash
.SHELLFLAGS := -euo pipefail -c
.DEFAULT_GOAL := help
.DELETE_ON_ERROR:

ROOT_DIR := $(patsubst %/,%,$(dir $(abspath $(lastword $(MAKEFILE_LIST)))))
NPM ?= npm
DRY_RUN ?= 0

CLEAN_MAILBOXES_ARGS :=
ifneq ($(filter 1 true yes,$(DRY_RUN)),)
CLEAN_MAILBOXES_ARGS := --dry-run
endif

.PHONY: help setup setup-clean check typecheck lint knip type-coverage test test-watch clean-mailboxes

##@ General
help: ## Show available make targets
	@awk 'BEGIN {FS = ":.*## "; printf "Usage:\n  make <target>\n"} /^##@ / {printf "\n%s\n", substr($$0, 5)} /^[a-zA-Z0-9_.-]+:.*## / {printf "  %-18s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

##@ Setup
setup: ## Register this checkout as a local pi package
	"$(ROOT_DIR)/scripts/setup-pi"

setup-clean: ## Remove this checkout's pi package registration
	"$(ROOT_DIR)/scripts/setup-pi-clean"

##@ Quality
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

##@ Tests
test: ## Run tests
	$(NPM) test

test-watch: ## Run tests in watch mode
	$(NPM) run test:watch

##@ Maintenance
clean-mailboxes: ## Clean stale agent mailboxes (set DRY_RUN=1 to preview)
	"$(ROOT_DIR)/scripts/clean-mailboxes" $(CLEAN_MAILBOXES_ARGS)

