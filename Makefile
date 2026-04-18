# pi-tools-and-skills — common tasks

.DEFAULT_GOAL := help

.PHONY: help setup check test build up down attach logs backup pi stack rotate-token clean-mailboxes clean

# ── Local development ────────────────────────────────────────────

OPENROUTER ?=
SETUP_ARGS =
ifeq ($(OPENROUTER),0)
  SETUP_ARGS += --no-openrouter
endif
ifeq ($(OPENROUTER),1)
  SETUP_ARGS += --openrouter
endif

help: ## Show available make targets
	@awk 'BEGIN {FS = ":.*## "; printf "Usage:\n  make <target> [VAR=value]\n\nTargets:\n"} /^[a-zA-Z0-9_.-]+:.*## / {printf "  %-18s %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@printf "\nSetup options:\n"
	@printf "  make setup OPENROUTER=0   # disable OpenRouter during setup\n"
	@printf "  make setup OPENROUTER=1   # force-enable OpenRouter during setup\n"

setup: ## Configure pi extensions, skills, shell hooks, and OS dependencies
	scripts/setup-pi $(SETUP_ARGS)

check: ## Run typecheck, lint, knip, and type-coverage
	npm run check

test: ## Run tests
	npm test

# ── Docker deployment ────────────────────────────────────────────

S = scripts

build: ## Build the coas-agent container
	. $(S)/_resolve-env.sh && docker compose build coas-agent

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

up: ## Start the CoAS stack (bootstraps on first run)
	$(S)/coas-up $(UP_ARGS)

down: ## Stop the CoAS stack
	$(S)/coas-down

attach: ## Open a shell/pi session inside the container
	@exec $(S)/coas-attach

logs: ## Tail CoAS service logs
	$(S)/coas-logs

backup: ## Snapshot persistent state
	$(S)/coas-backup

pi: ## Start pi in the CoAS workspace
	@exec $(S)/coas-pi

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
