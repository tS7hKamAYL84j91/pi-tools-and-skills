# Pi Research Tools Extension

Registered research-tool surface for pi.

This first T-195 slice is deliberately safe and additive:

- registers typed tools: `arxiv_search`, `semantic_scholar`, `semantic_scholar_search`, `github_search`, and `web_read`;
- returns JSON output plus structured tool details;
- performs no live network/API calls;
- reads no credentials;
- writes no artifacts;
- preserves existing deep-research prompts and workflows.

## Tools

| Tool | Parameters | Behavior |
|---|---|---|
| `arxiv_search` | `query`, `limit?`, `persistToWorkspace?` | Dry-run JSON search envelope for future arXiv provider binding. |
| `semantic_scholar` | `query`, `limit?`, `persistToWorkspace?` | Dry-run JSON search envelope for future Semantic Scholar provider binding. |
| `semantic_scholar_search` | `query`, `limit?`, `persistToWorkspace?` | Compatibility alias matching existing deep-research prompt language. |
| `github_search` | `query`, `limit?`, `persistToWorkspace?` | Dry-run JSON search envelope for future GitHub provider binding. |
| `web_read` | `url`, `persistToWorkspace?` | Dry-run JSON URL-read envelope for future fetch provider binding. |

`persistToWorkspace` only records intent in the dry-run envelope. It does not write `sources/manifest.json`.

## Boundaries

Future work needs separate approval before adding live providers, credentials, rate-limit handling, runtime artifact persistence, or deleting/replacing existing deep-research behavior.
