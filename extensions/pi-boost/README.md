# Boost

Switch to a boost model, run a prompt with anti-rut framing, switch back.

## What this does

- `/boost <prompt>` — switches to the boost model, sends your prompt with anti-rut framing, then restores your original model after the turn.
- `/boost settings` — pick your boost model and max yields.
- `/boost status` — show current yields and model configuration.
- `/boost reset` — reset the yield count.

## What this does NOT do

- Does not spawn child processes.
- Does not use fusion panels or judges.
- Does not modify your default model.
- Does not persist yield state across sessions.
