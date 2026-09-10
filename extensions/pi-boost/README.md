# Boost

Switch to a boost model, run a prompt with anti-rut framing, switch back (ADR-057).

## What this does

- `/boost <prompt>` — switches the session to the boost model, sends your prompt with anti-rut framing, and restores your previous model when the run settles (after retries/follow-ups).
- `/boost` or `/boost settings` — select **Boost model** and press Enter for Pi's actual `/model` selector (search, scoped/all toggle, catalog refresh). Pick a model or press Esc to return to settings; selection changes only `boost.model`, not the active session or Pi's default model. The next rows configure max yields and **Lease time (minutes)**: 5, 10, 15, 30, or 60.
- `/boost status` — show lease state, yields, configured duration, and model configuration.
- `/boost reset` — reset the yield count; also retries baseline restoration if a restore failed.
- `/boost clear` — clear the configured boost model (back to auto).

## Lease behavior

- A lease covers up to 3 yields and expires after the configured duration from its first yield (default 10 minutes). The next `/boost` or `/boost <prompt>` automatically renews an idle expired lease; no manual reset needed. `/boost status` is read-only.
- Duration changes apply to the current lease too, measured from its original start. Settings persist as `boost.leaseMinutes`; integer values 1–60 are accepted, invalid values fall back to 10.
- The lease is **not a model-switch timer**. Boost restores the baseline when the run settles, never in the middle of a running turn.
- Powerline shows only lease state and remaining yields: `Boost off · 3 left`, `Boost active · 2 left`, `Boost expired · 2 left`, `Boost blocked · restore failed`.
- Max yields is hard-capped at 3 per lease. Exhausting the count before expiry still requires `/boost reset`.
- If baseline restoration fails, boost blocks further dispatch until `/boost reset` retries the restore.

## What this does NOT do

- Does not spawn child processes.
- Does not use fusion panels or judges.
- Does not persist yield state across sessions.
- Does not replay your prompt on reset.
