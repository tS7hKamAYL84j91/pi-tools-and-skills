---
name: pi-session-management
description: Build session-aware pi behavior. Use when handling session lifecycle events, extension state persistence, compaction, reloads, follow-up delivery modes, or fork/resume/new session transitions.
---

# Pi Session Management

Use this skill when an extension or workflow depends on pi session lifecycle behavior.

## When to use

Use this skill for:
- persisting extension state across sessions
- restoring state on startup, reload, resume, or fork
- triggering or shaping compaction
- sending follow-up or steer messages safely
- reasoning about session boundaries and reload behavior

## Workflow

1. **Identify the lifecycle boundary**
   - Determine whether the change affects startup, reload, new session, resume, fork, or shutdown.
   - Do not assume all entry paths behave the same.

2. **Separate LLM context from extension state**
   - Use session entries for extension-owned persistent state.
   - Do not treat persisted entries as automatically visible to the model.

3. **Restore state explicitly**
   - Rehydrate state during `session_start`.
   - Handle different `reason` values deliberately.
   - Make initialization idempotent.

4. **Send messages with the right delivery mode**
   - Use follow-up delivery for normal queued user messages.
   - Use steer delivery when redirecting an active turn.
   - Avoid racing active turns; check idle state when relevant.

5. **Treat reload carefully**
   - Assume code after a reload trigger may still be running in the old version.
   - Structure reload handlers so the reload call is effectively terminal.

6. **Use compaction intentionally**
   - Compact when the context is getting noisy or after a major milestone.
   - Add custom instructions when the summary should preserve specific state.

## Design rules

- Persist only what must survive session boundaries.
- Reconstruct derived state instead of storing everything.
- Keep startup restoration deterministic and repeatable.
- Be explicit about whether data is for extension logic or model context.
- Prefer simple lifecycle flows over clever hidden coupling.

## Checklist

Before finishing a session-aware change, verify:
- startup path works
- reload path works
- follow-up/steer delivery is correct
- persisted state restores correctly
- no code depends on `ctx.signal` being always present
