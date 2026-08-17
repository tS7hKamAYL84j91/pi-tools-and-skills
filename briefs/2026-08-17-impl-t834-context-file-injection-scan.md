# T-834 — Context-file injection scanning for AGENTS.md

## Goal

Add a runtime scan in `pi-panopticon` that inspects `AGENTS.md` context files
for prompt-injection patterns before they are loaded into an agent's system
context. Surface a clear warning when a file is rejected, and do not let the
suspicious content reach the model. Adopts the Hermes Agent defense-in-depth
recommendation for context-file scanning.

## Background

pi's runtime loads `AGENTS.md` files from the project tree as context files.
A malicious or compromised file can override the agent's role, leak
instructions, or exfiltrate credentials. The repo already redacts
Matrix/prompt bodies and validates tool names; this adds a static-pattern guard
for context files.

## Scope

This change is limited to `extensions/pi-panopticon`. It does **not** change how
pi's core resource loader discovers files; it adds a scan step that panopticon
can invoke before spawn or expose as a diagnostic tool.

## Approach

1. Create `extensions/pi-panopticon/security/context-file-scan.ts` with:
   - `scanContextFile(path: string, content: string): ContextFileScanResult`
   - A pattern set covering:
     - Hidden instruction overrides (`ignore previous instructions`,
       `ignore the above`, `you are now`, `your new role is`)
     - Role/system-prompt overrides (`system prompt`, `you are a helpful`,
       `you are an assistant` outside normal boundaries)
     - Credential exfiltration (`send.*api[_ -]?key`, `output.*token`,
       `post.*secret`, `exfiltrate`, `leak.*credential`)
     - Delimiter tricks (`<\|im_end\|>`, raw `\n\nHuman:`, `\n\nAssistant:`)
     - Encoding obfuscation (zero-width characters, excessive Unicode
       homoglyphs, reversed text)
   - Patterns are case-insensitive regexes with bounded redaction of any
     matched fragment (no secrets or full file content in logs).

2. Add `findContextFiles(cwd: string): string[]` that discovers `AGENTS.md`
   files by walking up from `cwd` (matching pi's default discovery convention).

3. Add `scanWorkspaceContextFiles(cwd: string): ScanSummary` that scans all
   discovered files and returns a summary of allowed/rejected paths with
   reasons.

4. Wire into the spawner:
   - Before `extensions/pi-panopticon/spawner/spawner-tools.ts` spawns a child
     agent, call `scanWorkspaceContextFiles(cwd)`.
   - If any file is rejected, log a warning, surface `ctx.ui.notify`, and pass
     `--no-context-files` (or equivalent spawn flag) so the child starts without
     the compromised context.
   - If all files are clean, spawn proceeds normally.

5. Add a diagnostic tool `panopticon_scan_context_files` registered in
   `extensions/pi-panopticon/index.ts` so users can run a manual scan.

6. Add tests in `tests/panopticon/context-file-scan.test.ts`:
   - Clean `AGENTS.md` passes.
   - Files with hidden instructions, role overrides, exfiltration prompts,
     and delimiter tricks are rejected.
   - Zero-width/homoglyph obfuscation is detected.
   - `scanWorkspaceContextFiles` walks parent directories and aggregates results.

## Files to change

- `extensions/pi-panopticon/security/context-file-scan.ts` — new scanner.
- `extensions/pi-panopticon/spawner/spawner-tools.ts` — pre-spawn scan.
- `extensions/pi-panopticon/index.ts` — register diagnostic tool.
- `tests/panopticon/context-file-scan.test.ts` — new tests.

## Acceptance gates

- [ ] Scanner detects hidden-instruction, role-override, exfiltration,
      delimiter, and encoding-obfuscation patterns.
- [ ] Spawner rejects or sanitizes context when a scan fails.
- [ ] Diagnostic tool surfaces scan results to the user.
- [ ] Logs redact matched fragments and file content.
- [ ] `npm run check` clean.
- [ ] `npm test` passes, including new tests.

## Review plan

Navigator review; no ADR required (defensive scanning, no authority change).
