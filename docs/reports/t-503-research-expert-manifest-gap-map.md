# T-503 Research-Expert to Research-Tool Manifest Gap Map

Date: 2026-05-22

## Summary

This report compares the T-502 local research-tool manifest shape with current repo-local research usage. No `research-expert` skill or standalone script exists in this repo under `skills/`, `scripts/`, or `extensions/`; the active research-expert-like behavior is the `pi-teams` `deep-research` team and its Explorer/Verifier/Synthesis agent descriptors.

Recommendation: **not ready for migration/deletion**. The manifest shape is useful for discoverable read-only research tool metadata, but current deep-research prompts rely on implicit tool names, workspace persistence, and evidence-binding behavior that the manifest does not yet execute or enforce.

## Current repo-local research usage

| Source | Capability / usage | Current implied tool or behavior | Manifest mapping | Gap / risk | Migration step |
|---|---|---|---|---|---|
| `extensions/pi-teams/config/agents/deep-research-explorer.md` | Break prompt into verifiable checklist | model instruction, no tool manifest | Not a tool; workflow/prompt behavior | Should remain in team prompt/protocol, not tool manifest | Keep in team/subagent descriptor. |
| `deep-research-explorer.md` | Gather evidence with `arxiv_search`, `semantic_scholar_search`, `fetch_content` | implicit tool names | Added metadata fixtures for `arxiv_search`, `semantic_scholar_search`, `fetch_content` | Metadata only; no invocation, auth, rate limits, or persistence | Future T-195 design must bind actual implementations to these names. |
| `deep-research-explorer.md` | Optional `pi-research` tools with `persistToWorkspace: true` | workspace persistence to `sources/manifest.json` | T-504 adds local `artifactPersistence` metadata with `persistToWorkspace`, `artifactPath`, `sourceIdField`, and provenance fields | Metadata only; no runtime persistence or artifact write semantics | Define runtime artifact write/read behavior before replacing prompt-only guidance. |
| `deep-research-explorer.md` | `web_search` / `fetch_content` findings and URLs recorded | implicit search/read behavior | `web_read` fixture partially maps URL read; no `web_search` fixture yet | Search vs read are distinct; search result ranking/error behavior not represented | Add `web_search` metadata only when a local/non-live fixture is needed. |
| `deep-research-verifier.md` | Cross-reference Explorer findings with `sources/manifest.json` | reads workspace artifact | Not represented as a research tool | Manifest lacks artifact dependency/claim-check input metadata | Add artifact dependency field or keep as team protocol behavior. |
| `deep-research-verifier.md` | Reject generated summaries; require primary text/sourceId/URL | safety/evidence policy | safety constraints can express policy | Not machine-enforced by manifest | Future evaluator/gate needed before migration. |
| `deep-research-synthesis.md` | Final report only from verified facts with inline citations | synthesis policy | Not a tool | Should remain team protocol/prompt behavior | No tool migration. |
| `extensions/pi-teams/config/teams/deep-research.md` | Bounded Explorer/Verifier loop and `VERIFIED_COMPLETE` stop | protocol runtime | Not a tool | Tool manifest should not own graph/protocol control | Keep in `pi-teams` protocol. |

## T-502 manifest fit

The manifest fields map well for **discoverability**:

- `name`: implicit tool names from Explorer prompt.
- `purpose`: why a tool exists in research.
- `inputs` / `outputs`: query/source inputs and bounded evidence outputs.
- `safety`: no-credentials/no-live-network fixture posture; future source persistence and untrusted-input handling.
- `invocationNotes`: source verification and citation-binding reminders.

The manifest does **not** yet cover full migration requirements:

- runtime workspace persistence behavior for `artifactPersistence` metadata;
- error taxonomy and retry/rate-limit behavior;
- source trust/citation quality levels;
- live provider availability/credentials;
- tool execution wiring;
- protocol-level verifier/synthesis policies.

## Fixture updates made

T-503 added metadata-only fixtures for current Explorer prompt tool names:

- `arxiv_search`
- `semantic_scholar_search`
- `fetch_content`

Existing fixtures remain:

- `github_search`
- `web_read`

All fixtures explicitly state that no live API/network/credential behavior is implemented.

## Migration recommendation

**Not ready for T-195 deletion/migration.** Proceed in small gates:

1. Define runtime artifact persistence and readback semantics for T-504 metadata.
2. Add local fixture metadata for `web_search` if current prompts keep referencing it.
3. Define error/output semantics for failed searches, empty results, rate limits, and malformed source content.
4. Only then consider a local tool registry adapter that maps manifest entries to real implementations.
5. Keep Explorer/Verifier/Synthesis prompt/protocol behavior in `pi-teams`; do not force protocol policy into tool metadata.

## Gates before full T-195

Require ADR or design note before any of these:

- deleting or replacing a research skill/prompt;
- extension discovery/loading changes;
- network-backed tools or credentials;
- durable public plugin manifest contract;
- provider/model-backed research workflow changes;
- workspace artifact persistence semantics.

## ADR disposition

No ADR is needed for this comparison and local fixture metadata update. ADR/design note required before skill deletion, extension loading changes, network-backed tools/credentials, durable public plugin contract, or artifact persistence semantics.
