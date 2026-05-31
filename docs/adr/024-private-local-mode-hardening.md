# ADR 024: Private Local IPC Mode Hardening

## Status

Accepted.

## Context

Panopticon agent coordination uses local filesystem IPC under `~/.pi/agents` for registry records, Maildir inboxes, and socket-path diagnostics. These paths are private local coordination state and must fail closed against permissive modes and symlink substitution.

## Decision

Pi-owned Panopticon IPC paths use metadata-only hardening:

- registry and Maildir directories are expected to be `0700`;
- registry/message files are expected to be `0600`;
- symlinked registry, Maildir, and IPC files are rejected before read/write use;
- checks use `lstat`/mode metadata only and do not inspect private session or record contents beyond existing registry/message JSON reads needed by Panopticon itself.

`coas-archive` private-record mode enforcement is not implemented in this repository slice. The archive record format, ownership, migration behavior, and enforcement points belong to Quartermaster/coas. Pi-tools should only consume coas outputs through documented interfaces; a follow-up should add equivalent metadata-only mode checks in the coas owner repo.

## Consequences

Existing permissive `~/.pi/agents` paths will be tightened to private modes when pi-tools creates or uses them. Symlinked IPC paths fail closed instead of being followed.
