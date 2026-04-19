# pi-tools-and-skills — common tasks

.DEFAULT_GOAL := help

.PHONY: help setup check test build up down attach logs backup gravitas-pending gp-attach gp-status gp-stop gp-restart stack rotate-token clean-mailboxes clean

# ── Local development ────────────────────────────────────────────

OPENROUTER ?=
SETUP_ARGS =
ifeq ($(OPENROUTER),0)
  SETUP_ARGS += --no-openrouter
endif
ifeq ($(OPENROUTER),1)
  SETUP_ARGS += --openrouter
endif

S = scripts

help: ## Show available make targets
	@awk 'BEGIN {FS = ":.*## "; printf "Usage:\n  make <target> [VAR=value]\n\nTargets:\n"} /^[a-zA-Z0-9_.-]+:.*## / {printf "  %-18s %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@printf "\nSetup options:\n"
	@printf "  make setup OPENROUTER=0   # disable OpenRouter during setup\n"
	@printf "  make setup OPENROUTER=1   # force-enable OpenRouter during setup\n"

setup: ## Configure pi extensions, skills, shell hooks, and OS dependencies
	$(S)/setup-pi $(SETUP_ARGS)

check: ## Run typecheck, lint, knip, and type-coverage
	npm run check

test: ## Run tests
	npm test

# ── Gravitas Pending — resident zellij session ───────────────────

GP_SESSION := gravitas-pending
GP_LAYOUT  := /tmp/gp-layout.kdl
GP_RUNNING  = zellij list-sessions 2>/dev/null | sed 's/\x1b\[[0-9;]*m//g' | grep -q "^$(GP_SESSION) \|^$(GP_SESSION)$$"
TOOLS_DIR  := $(shell cd "$(dir $(lastword $(MAKEFILE_LIST)))" && pwd)

gravitas-pending: ## Start CoAS (Gravitas Pending) in a resident zellij session
	@if $(GP_RUNNING); then \
		echo "✅ $(GP_SESSION) is already running."; \
		echo "   Attach:  make gp-attach"; \
		echo "   Status:  make gp-status"; \
	else \
		printf 'layout {\n    tab {\n        pane command="%s/$(S)/coas-pi" {\n            args "Run your startup checklist from AGENTS.md. Do not wait for human input."\n        }\n    }\n}\n' "$(TOOLS_DIR)" > $(GP_LAYOUT); \
		echo "Starting $(GP_SESSION)…"; \
		script -q /dev/null sh -c 'zellij -s $(GP_SESSION) --new-session-with-layout $(GP_LAYOUT) & sleep 2 && kill $$!' </dev/null >/dev/null 2>&1; \
		if $(GP_RUNNING); then \
			echo "✅ $(GP_SESSION) started (pi running inside zellij)."; \
			echo "   Attach:  make gp-attach"; \
		else \
			echo "❌ Failed to start $(GP_SESSION)."; \
			exit 1; \
		fi; \
	fi

gp-attach: ## Attach to the Gravitas Pending zellij session
	@if $(GP_RUNNING); then \
		zellij attach $(GP_SESSION); \
	else \
		echo "$(GP_SESSION) is not running. Start with: make gravitas-pending"; \
		exit 1; \
	fi

gp-status: ## Show Gravitas Pending session status
	@if $(GP_RUNNING); then \
		echo "✅ $(GP_SESSION) is running."; \
		echo "   Attach:  make gp-attach"; \
		zellij list-sessions 2>/dev/null | grep "$(GP_SESSION)"; \
	else \
		echo "⚪ $(GP_SESSION) is not running."; \
	fi

gp-stop: ## Stop the Gravitas Pending session
	@if $(GP_RUNNING); then \
		echo "Stopping $(GP_SESSION)…"; \
		zellij kill-session $(GP_SESSION) 2>/dev/null || true; \
		echo "✅ Stopped."; \
	else \
		echo "$(GP_SESSION) is not running."; \
	fi

gp-restart: gp-stop ## Restart Gravitas Pending
	@sleep 1
	@$(MAKE) gravitas-pending

# ── Docker deployment ────────────────────────────────────────────

UP_ARGS =
ifdef BOT_PASSWORD
  UP_ARGS += --bot-password '$(BOT_PASSWORD)'
endif
ifdef PERSONAL_USER
  UP_ARGS += --personal-user $(PERSONAL_USER)
endif
ifdef PERSONAL_PASSWORD
  UP_ARGS += --personal-password '$(PERSONAL_PASSWORD)'
endif

build: ## Build the coas-agent container
	. $(S)/_resolve-env.sh && docker compose build coas-agent

up: ## Start the CoAS stack (bootstraps on first run)
	$(S)/coas-up $(UP_ARGS)

down: ## Stop the CoAS stack
	$(S)/coas-down

attach: ## Open a shell inside the running container
	@exec $(S)/coas-attach

logs: ## Tail CoAS service logs
	$(S)/coas-logs

backup: ## Snapshot persistent state
	$(S)/coas-backup

stack: ## Run the supervised foreground stack
	@exec $(S)/coas-stack

rotate-token: ## Refresh and store the Matrix token
	$(S)/matrix-login --store

clean-mailboxes: ## Clean agent mailboxes
	$(S)/clean-mailboxes

# ── Cleanup ──────────────────────────────────────────────────────

clean: ## Remove local Matrix crypto state
	rm -rf ~/.pi/agent/matrix-crypto
	@echo "Crypto store wiped. Restart the agent to regenerate."
