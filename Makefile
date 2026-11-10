# pi-tools-and-skills — common tasks

SHELL := /bin/bash
.SHELLFLAGS := -euo pipefail -c
.DEFAULT_GOAL := help
.DELETE_ON_ERROR:

ROOT_DIR := $(patsubst %/,%,$(dir $(abspath $(lastword $(MAKEFILE_LIST)))))
NPM ?= npm
GITLEAKS ?= gitleaks
SEMGREP ?= semgrep
PACKAGE ?=
DRY_RUN ?= 0

CLEAN_MAILBOXES_ARGS :=
ifneq ($(filter 1 true yes,$(DRY_RUN)),)
CLEAN_MAILBOXES_ARGS := --dry-run
endif

# PROJECT=<dir> targets one project's .pi/settings.json instead of the global
# ~/.pi/agent/settings.json. Unset means global.
SETUP_SCOPE_ARGS :=
ifneq ($(strip $(PROJECT)),)
SETUP_SCOPE_ARGS := --project "$(strip $(PROJECT))"
endif

.PHONY: help setup setup-package setup-clean setup-package-clean ci doctor check typecheck lint knip type-coverage secret-scan semgrep-scan audit build test test-watch test-coverage test-tui check-package-imports clean-mailboxes

##@ General
help: ## Show available make targets
	@awk 'BEGIN {FS = ":.*## "; printf "Usage:\n  make <target>\n"} /^##@ / {printf "\n%s\n", substr($$0, 5)} /^[a-zA-Z0-9_.-]+:.*## / {printf "  %-24s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

##@ Setup
setup: ## Enable this repo in Pi settings (user default, or PROJECT=<dir> for one project)
	"$(ROOT_DIR)/scripts/setup-pi" $(SETUP_SCOPE_ARGS)

setup-package: ## Enable one extension in user Pi settings (PACKAGE=pi-agent-hub|pi-boost|pi-goal|pi-matrix|pi-ollama-models|pi-overview|pi-subagents|pi-team-workflows)
	@test -n "$${PACKAGE:-}" || { echo "Usage: make setup-package PACKAGE=<name>; see 'make help'"; exit 2; }
	"$(ROOT_DIR)/scripts/setup-pi" "$$PACKAGE"

setup-clean: ## Remove this repo from Pi settings (user default, or PROJECT=<dir>)
	"$(ROOT_DIR)/scripts/setup-pi-clean" $(SETUP_SCOPE_ARGS)

setup-package-clean: ## Remove one extension from user Pi settings (PACKAGE=pi-agent-hub|pi-boost|pi-goal|pi-matrix|pi-ollama-models|pi-overview|pi-subagents|pi-team-workflows)
	@test -n "$${PACKAGE:-}" || { echo "Usage: make setup-package-clean PACKAGE=<name>; see 'make help'"; exit 2; }
	"$(ROOT_DIR)/scripts/setup-pi-clean" "$$PACKAGE"

##@ Quality
ci: ## Run the CI gate locally (check, build, tests, package imports, security scans)
	$(NPM) run check
	$(NPM) run build:fleet-mcp
	$(NPM) test
	cd "$(ROOT_DIR)" && node scripts/check-package-imports.mjs .
	$(MAKE) --no-print-directory semgrep-scan audit secret-scan

doctor: check test secret-scan ## Run checks, tests, and secret scans

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

semgrep-scan: ## Run the custom Semgrep OSS rules (requires semgrep, or set SEMGREP_BIN)
	@command -v "$(SEMGREP)" >/dev/null 2>&1 || { echo "Error: semgrep not found. Install it with: pip install semgrep (or set SEMGREP_BIN)"; exit 127; }
	SEMGREP_BIN="$(SEMGREP)" $(NPM) run security:semgrep

audit: ## Audit production dependencies for high-severity advisories
	$(NPM) audit --omit=dev --audit-level=high

secret-scan: ## Scan git history and working tree for secrets with gitleaks
	@command -v "$(GITLEAKS)" >/dev/null 2>&1 || { echo "Error: gitleaks not found. Install it with: brew install gitleaks"; exit 127; }
	$(GITLEAKS) detect --source "$(ROOT_DIR)" --redact --no-banner --verbose
	@cd "$(ROOT_DIR)" && if $(GITLEAKS) dir --help >/dev/null 2>&1; then \
		$(GITLEAKS) dir "$(ROOT_DIR)" --redact --no-banner --verbose; \
	else \
		echo "gitleaks dir not supported; falling back to no-git working-tree scan"; \
		$(GITLEAKS) detect --source . --no-git --redact --no-banner --verbose; \
	fi

##@ Build
build: ## Build the standalone Fleet MCP adapter into dist/
	$(NPM) run build:fleet-mcp

##@ Tests
test: ## Run tests
	$(NPM) test

test-watch: ## Run tests in watch mode
	$(NPM) run test:watch

test-coverage: ## Run tests with coverage
	$(NPM) run test:coverage

check-package-imports: ## Resolve one package's entrypoints without running it (PACKAGE=path, default .)
	cd "$(ROOT_DIR)" && node scripts/check-package-imports.mjs "$(if $(PACKAGE),$(PACKAGE),.)"

test-tui: ## Run real-terminal acceptance tests (PTY; needs a trusted local pi checkout)
	$(NPM) run test:tui

##@ Maintenance
clean-mailboxes: ## Clean stale agent mailboxes (set DRY_RUN=1 to preview)
	"$(ROOT_DIR)/scripts/clean-mailboxes" $(CLEAN_MAILBOXES_ARGS)

