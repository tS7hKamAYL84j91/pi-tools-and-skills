# Pi Research Tools Extension

Registered research-tool surface for pi.

This first T-195 slice is deliberately safe and additive:

- registers typed tools: `arxiv_search`, `semantic_scholar`, `semantic_scholar_search`, `github_search`, and `web_read`;
- returns JSON output plus structured tool details;
- performs no live network/API calls;
- reads no credentials;
- writes no artifacts;
- preserves existing deep-research prompts and workflows.

## Stable Tools/Commands

### Tools

| Tool | Parameters | Behavior |
|---|---|---|
| `arxiv_search` | `query`, `limit?`, `persistToWorkspace?` | Dry-run JSON search envelope for future arXiv provider binding. |
| `semantic_scholar` | `query`, `limit?`, `persistToWorkspace?` | Dry-run JSON search envelope for future Semantic Scholar provider binding. |
| `semantic_scholar_search` | `query`, `limit?`, `persistToWorkspace?` | Compatibility alias matching existing deep-research prompt language. |
| `github_search` | `query`, `limit?`, `persistToWorkspace?` | Dry-run JSON search envelope for future GitHub provider binding. |
| `web_read` | `url`, `persistToWorkspace?` | Dry-run JSON URL-read envelope for future fetch provider binding. |

## Provisional Surfaces

- `persistToWorkspace` parameter (intent capture only).
- All tools currently operate in dry-run mode until provider bindings are stabilized.

## Cross-Extension Dependencies

- Utilized by `pi-teams` when running the `research` protocol.

`persistToWorkspace` only records intent in the dry-run envelope. It does not write `sources/manifest.json`.

## What this does NOT do

- Does not perform live provider, network, or API calls.
- Does not read credentials or keychains.
- Does not write `sources/manifest.json` or any other artifact.
- Does not delete or replace existing deep-research prompt behavior.
- Does not enable provider-backed behavior without a separate approved gate.

Future work needs separate approval before adding live providers, credentials, rate-limit handling, runtime artifact persistence, or deleting/replacing existing deep-research behavior.
