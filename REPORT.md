# Report: Decouple Messaging Transport from Agent Registry

## Summary

Completed Tasks 1-5 from Phase 4.1, 4.2, 4.3, 4.4 and Phase 2 of the plan. The messaging system is now properly decoupled from the agent registry, and subagents always have session files for `agent_peek` to read.

## Changes Made

### Task 1: Add pendingCount to MessageTransport (lib/message-transport.ts)

Added `pendingCount(agentId: string): number` to the `MessageTransport` interface. This method returns the number of pending inbound messages for an agent.

### Task 2: Implement pendingCount in MaildirTransport (lib/transports/maildir.ts)

Implemented `pendingCount()` in MaildirTransport:
- Counts `.json` files in `~/.pi/agents/{agentId}/inbox/new/`
- Returns 0 on error (directory not found, etc.)
- Same logic that was previously in `inboxPendingCount()` in agent-registry.ts

### Task 3: Subagents always get sessions (extensions/pi-subagent.ts)

Changed `buildArgList()` to always use a session directory:
- Added `defaultSubagentSessionDir(name)` function returning `~/.pi/agent/sessions/subagents/{name}/`
- Removed `--no-session` fallback
- Now always passes `--session-dir` with either the provided value or the default
- This ensures spawned agents always write session JSONL that `agent_peek` can read

### Task 4: Clean up agent-registry.ts (lib/agent-registry.ts)

- Removed `inboxCapable?: boolean` from `AgentRecord` interface
- Removed `inboxPendingCount()` function (moved to transport)
- Added `writeAgentRecord(record)` function for messaging extension to update `pendingMessages`

### Task 5: Messaging extension owns the count (extensions/pi-messaging.ts)

- Added `updatePendingCount()` helper that reads from `transport.pendingCount()` and writes to the agent record
- Calls `updatePendingCount()` after inbox draining
- Calls `updatePendingCount()` on `session_start` after `init()`
- Imports `writeAgentRecord` from agent-registry

## Tests Updated

### tests/pi-subagent.test.ts
- Updated `buildArgList` tests to include `name` parameter (now required)
- Changed test for `--no-session` to test default session dir behavior

### tests/pi-messaging.test.ts
- Added `pendingCount` to mock transport
- Added `writeAgentRecord` mock

### tests/maildir-transport.test.ts
- Added `readdirSync` mock
- Added 4 tests for `pendingCount()` method

## Test Results

All 75 tests passing across 4 test files.

## Ownership Summary (After Changes)

| Concern | Owner | Storage |
|---------|-------|---------|
| Agent registry (who's alive) | panopticon | `~/.pi/agents/{id}.json` |
| Activity log (what happened) | pi core | `~/.pi/agent/sessions/…/*.jsonl` |
| Message delivery | messaging ext | transport-dependent (maildir: `~/.pi/agents/{id}/inbox/`) |
| Pending message count | messaging ext | writes to AgentRecord, panopticon reads |
| Subagent sessions | subagent ext | `~/.pi/agent/sessions/subagents/{name}/` |