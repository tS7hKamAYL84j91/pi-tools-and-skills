# pi-tools-and-skills — common tasks

.DEFAULT_GOAL := help

.PHONY: help setup check test clean-mailboxes

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

clean-mailboxes: ## Clean stale agent mailboxes
	scripts/clean-mailboxes
