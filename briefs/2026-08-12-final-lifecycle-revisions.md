# Final Lifecycle and Resource Revisions

## Goal

Close final lifecycle/resource blockers.

## Required changes

1. CoAS scheduler tracks start recovery/reconcile and tick promises, closes admission on stop, waits for in-flight work, then marks all active runs interrupted and clears state. Dispatch checks stopping immediately before `sendUserMessage`.
2. Matrix attachment byte reservation spans download, MIME/size validation, and cache write. Every non-success stream exit cancels/releases the reader before releasing reservation.
3. Runtime child processes own a process tree: POSIX uses a detached process group and signals negative PID; Windows uses an equivalent bounded tree termination (`taskkill /T` or documented tested adapter). Cancellation waits for the tree/direct child close and retains existing output bounds.
4. Goal load projection repair serializes/rechecks authority against concurrent save.
5. Team async writer and reader resolve one result root before the run and pass it to both paths without growing `team-runtime.ts` hotspot.

## Acceptance criteria

- Deterministic paused-operation tests cover scheduler stop against in-flight tick/reconcile and no post-stop delivery.
- Matrix blocked cache-write test proves reservations remain held; oversize/abort cancels reader.
- Child test spawns a marker-writing grandchild and proves cancellation prevents marker after result.
- Goal concurrent load/save test leaves projections matching current authority.
- Team test changes settings mid-run and still reads writer root.
- Full check/test/diff gates pass without fitness exceptions.
