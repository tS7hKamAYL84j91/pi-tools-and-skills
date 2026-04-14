# pi-tools-and-skills — common tasks
#
# Local development:
#   make setup          # configure pi extensions, skills, shell hooks
#   make check          # typecheck + lint + knip + type-coverage
#   make test           # run tests
#
# Docker deployment (coas-infra):
#   make up             # start stack (bootstraps on first run)
#   make down           # stop stack
#   make attach         # start pi inside the container
#   make logs           # tail service logs
#   make backup         # snapshot persistent state
#
# First-time docker deployment:
#   make up BOT_PASSWORD=X PERSONAL_USER=jim PERSONAL_PASSWORD=Y

.PHONY: setup check test up down attach logs backup clean

# ── Local development ────────────────────────────────────────────

setup:
	./setup-pi.sh

check:
	npm run check

test:
	npm test

# ── Docker deployment ────────────────────────────────────────────

INFRA = coas-infra/scripts

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

up:
	$(INFRA)/coas-up $(UP_ARGS)

down:
	$(INFRA)/coas-down

attach:
	$(INFRA)/coas-attach

logs:
	$(INFRA)/coas-logs

backup:
	$(INFRA)/coas-backup

# ── Cleanup ──────────────────────────────────────────────────────

clean:
	rm -rf ~/.pi/agent/matrix-crypto
	@echo "Crypto store wiped. Restart the agent to regenerate."
