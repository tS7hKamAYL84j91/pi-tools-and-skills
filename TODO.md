# Work tracking

**Kanban ticket bodies are the source of truth for this repository's actionable work and durable plans (T-890).** A bounded execution projection/scratch checklist may be linked to a ticket, but must not become a parallel authority.

- Open `/kanban` in the configured workspace, or use `kanban_export_json` for read-only inspection. Search by ticket ID/title and the `pi-tools-and-skills` tag; older tickets may use legacy names or extension-specific tags.
- The canonical shared board is `working-notes/executive-office/chief-of-staff/pi-kanban/board.log` in the sibling working-notes checkout (`KANBAN_DIR` selects it). This GM may directly create, claim, and update repo-scoped tickets through Kanban tools despite the shared board location. Respect WIP, ownership, and evidence gates; do not edit the event log directly or mutate unrelated working-notes files.
- Tickets hold priority, scope, ownership, blockers, acceptance criteria, evidence, and next actions. Update Kanban when work changes or completes; TODO alone is not completion evidence. Link specifications, implementation plans, and ADRs from tickets to this repository's `docs/` files.
- Close obsolete work with an explicit won't-do/superseded reason; do not report it as implemented. Reuse existing tickets rather than creating duplicates.

## Migration handoff

Gravitas confirmed the migration on **T-890**. Canonical tickets are **T-886** (Goals), **T-891** (UX), **T-892** (onboarding/usability), and **T-893** (extension cleanup). This is a lookup guide, not priority order or authorization to start work.

The previous checklist and migration-time dispositions are preserved in the [frozen migration source record](docs/reports/kanban-backlog-migration-source.md), not a second maintained backlog. Consult Kanban for current status.
