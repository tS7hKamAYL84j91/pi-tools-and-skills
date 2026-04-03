# Parallel Refactor — Fix Abstraction Bleeds

## Architecture

Three agents work in parallel. Each owns specific files. **No file overlap.**
The lead (me) handles `lib/agent-registry.ts` integration at the end.

## File Ownership

| Agent | Owns (read+write) | May read (no write) |
|-------|-------------------|---------------------|
| transport-worker | `lib/transports/maildir.ts`, `tests/maildir-transport.test.ts` | `lib/agent-registry.ts`, `lib/message-transport.ts` |
| panopticon-worker | `extensions/pi-panopticon.ts`, `tests/panopticon-pure.test.ts` | `lib/agent-registry.ts` |
| messaging-worker | `extensions/pi-messaging.ts`, `tests/pi-messaging.test.ts` | `lib/agent-registry.ts` |

**NOBODY touches `lib/agent-registry.ts` — the lead handles that last.**

## Stream A: transport-worker (BLEED-2)

**Goal:** Maildir transport becomes self-contained — no inbox IO imports from agent-registry.

1. TDD: Write tests for inline inbox functions (ensureInbox, readNew, ack, prune)
2. Copy the 4 inbox functions from agent-registry into maildir.ts as private functions
3. Copy the InboxMessage interface
4. Update MaildirTransport methods to use local functions instead of imports
5. Remove agent-registry imports for inbox functions (keep REGISTRY_DIR, AgentRecord)
6. Run `npm test` — all tests pass

## Stream B: panopticon-worker (BLEED-1, BLEED-3, BLEED-4)

**Goal:** Panopticon stops managing messaging infrastructure; socket types are local.

1. TDD: Write test for cleanupAgentFiles — assert it only deletes .json and .sock, NOT the agent directory
2. Define SocketCommand interface locally in panopticon (copy from agent-registry)
3. Define SOCKET_TIMEOUT_MS locally in panopticon
4. Remove imports of SocketCommand, SOCKET_TIMEOUT_MS, ensureInbox from agent-registry
5. Remove `ensureInbox(selfId)` call from session_start
6. Fix cleanupAgentFiles: only `unlinkSync` the .json and .sock files, do NOT `rmSync` the directory
7. Run `npm test` — all tests pass

## Stream C: messaging-worker (BLEED-5)

**Goal:** Messaging caches self-identity instead of scanning all records every call.

1. TDD: Write tests verifying cached lookup behavior
2. Add `selfId` field cached on session_start
3. Refactor getSelfRecord() to use cached selfId for targeted lookup
4. Ensure selfName is also cached correctly
5. Run `npm test` — all tests pass

## Integration (lead, after all 3 done)

1. Remove dead exports from agent-registry.ts:
   - `ensureInbox` (now private in maildir.ts)
   - `inboxReadNew` (now private in maildir.ts)
   - `inboxAcknowledge` (now private in maildir.ts)
   - `inboxPruneCur` (now private in maildir.ts)
   - `InboxMessage` (already unexported)
   - `SocketCommand` (now local in panopticon)
   - `SOCKET_TIMEOUT_MS` (now local in panopticon)
2. Run full check: `npm run check && npm test`
3. Verify knip shows no new unused exports
