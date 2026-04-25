# pi-tools-and-skills — common tasks

SHELL := /bin/bash
.DEFAULT_GOAL := help

ROOT_DIR := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))
NPM ?= npm

.PHONY: help setup setup-clean check typecheck lint knip type-coverage test test-watch clean-mailboxes

OPENROUTER ?=
ifneq ($(OPENROUTER),)
  ifeq ($(filter $(OPENROUTER),0 1),)
    $(error OPENROUTER must be 0, 1, or empty)
  endif
endif

SETUP_ARGS :=
ifeq ($(OPENROUTER),0)
  SETUP_ARGS += --no-openrouter
endif
ifeq ($(OPENROUTER),1)
  SETUP_ARGS += --openrouter
endif

DRY_RUN ?= 0
ifeq ($(DRY_RUN),1)
  CLEAN_MAILBOX_ARGS := --dry-run
else ifeq ($(DRY_RUN),0)
  CLEAN_MAILBOX_ARGS :=
else
  $(error DRY_RUN must be 0 or 1)
endif

help: ## Show available make targets
	@awk 'BEGIN {FS = ":.*## "; printf "Usage:\n  make <target> [VAR=value]\n\nTargets:\n"} /^[a-zA-Z0-9_.-]+:.*## / {printf "  %-18s %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@printf "\nSetup options:\n"
	@printf "  make setup OPENROUTER=0   # disable OpenRouter during setup\n"
	@printf "  make setup OPENROUTER=1   # force-enable OpenRouter during setup\n"
	@printf "  make clean-mailboxes DRY_RUN=1  # show stale mailbox cleanup actions\n"

setup: ## Configure pi extensions, skills, shell hooks, and OS dependencies
	$(ROOT_DIR)scripts/setup-pi $(SETUP_ARGS)

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
	$(ROOT_DIR)scripts/clean-mailboxes $(CLEAN_MAILBOX_ARGS)

setup-clean: ## Reverse setup-pi changes (remove extensions, shell hooks, models.json)
	$(ROOT_DIR)scripts/setup-pi-clean $(CLEAN_MAILBOX_ARGS)
