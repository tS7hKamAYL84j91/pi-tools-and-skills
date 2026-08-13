# Final Security Revisions

## Goal

Close final reviewer blockers without expanding public behavior.

## Required changes

1. Advisory locks fail closed on existing locks; remove unsafe automatic stale-lock deletion. Owner metadata remains diagnostic. No process may unlink another owner’s lock. Reject symlink/non-regular/oversized lock metadata before reading.
2. External-agent manifest reads return empty only for ENOENT. Malformed, unreadable, non-array, or symlinked manifests fail closed and are never overwritten by registration.
3. Team definition create/update/delete must reject symlinked `teams` directories and final team-file symlinks, matching generated-agent confinement.
4. Ollama execution uses an operator-approved absolute executable. Environment override must be absolute and basename `ollama`; defaults may use only fixed standard absolute locations, never cwd/PATH resolution.
5. Preserve previous public gate fields as deprecated, ignored, non-executing inputs. Trusted environment gates remain separate. `/pi-doctor --gate` and `gateCommand` are accepted for compatibility but never executed and should surface deprecation where practical.

## Acceptance criteria

- Lock tests cover symlink, non-regular/oversized metadata, and prove no stale auto-removal; lock owner only releases its own current regular file.
- Manifest tests cover corrupt, permission/read failure where practical, non-array, and cross-workspace symlink preservation.
- Team tests cover symlinked teams directory on create/update/delete.
- Ollama tests prove bare/PATH/project executable cannot run and an absolute trusted fixture works.
- Gate schemas retain deprecated fields while tests prove model values never execute.
- Full check/test/diff gates pass.
