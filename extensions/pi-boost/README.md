# Boost

Switch to a boost model, run a prompt with anti-rut framing, switch back (ADR-057).

## What this does

- `/boost <prompt>` — switches the session to the boost model, sends your prompt with anti-rut framing, and restores your previous model when the run settles (after retries/follow-ups).
- `/boost settings` — max yields; press `m` for the native-style searchable model picker.
- `/boost status` — show lease state, yields, and model configuration.
- `/boost reset` — reset the yield count; also retries baseline restoration if a restore failed.
- `/boost clear` — clear the configured boost model (back to auto).

## Lease behavior

- A lease covers up to 3 yields and expires 10 minutes after its first yield; expired leases deny dispatch until `/boost reset` starts a new lease (T-854).
- Powerline shows only lease state and remaining yields: `Boost off · 3 left`, `Boost active · 2 left`, `Boost expired · 2 left`, `Boost blocked · restore failed`.
- Max yields is hard-capped at 3 per lease.
- If baseline restoration fails, boost blocks further dispatch until `/boost reset` retries the restore.

## What this does NOT do

- Does not spawn child processes.
- Does not use fusion panels or judges.
- Does not persist yield state across sessions.
- Does not replay your prompt on reset.