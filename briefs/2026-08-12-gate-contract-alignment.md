# Validation Gate Contract Alignment

## Goal

Remove model-supplied arbitrary shell execution from public diagnostic/completion tools while retaining explicit, operator-configured autonomous quality gates.

## Decision

- Public/model-visible tools no longer accept `gateCommand` / `gate_command` strings.
- `pi-doctor` is strictly read-only and never executes a command.
- Goal and Kanban completion may execute only an operator-configured gate from environment/settings (`PI_GOAL_GATE_COMMAND`, `KANBAN_GATE_COMMAND`, or an existing trusted config equivalent), not tool parameters.
- Structured check evidence remains supported.

## Constraints

- Preserve tool names and completion behavior when no configured gate exists.
- If a trusted gate is configured, failure still blocks completion and returns bounded diagnostics.
- Do not add a generic named-script framework or dependency.
- Update docs and tests to match actual behavior; remove obsolete public schema fields.
- Existing runtime-child-process bounds apply.
- No fitness exceptions.

## Acceptance criteria

- Registration tests prove public schemas omit shell command fields.
- Doctor cannot execute a gate via tool or command arguments.
- Goal/Kanban trusted env gate pass/fail tests work; model-supplied extra fields cannot select commands.
- READMEs accurately state operator-configured execution and trust boundary.
- Check/test/diff gates pass.
