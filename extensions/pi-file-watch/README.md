# pi-file-watch

Small configurable watcher for explicitly listed files.

## What it does

- Watches only configured file paths with `node:fs.watch` and `recursive: false`.
- Debounces file-system events, then batches notifications to reduce autosave noise.
- Emits metadata-only hidden `firewatch_batch` messages; it does not open overlays or inject file contents.
- Allows symlink or external workspace targets by config.
- Provides `/file-watch`, `file_watch_list`, and `file_watch_reload`.

## What this does NOT do

- No recursive discovery or scans.
- No file writes or state files.
- No automatic path creation.
- No shell execution.
- No file-body injection; agents should use read tools when content is needed.
- No overlay/editor UX; `/file-watch` only refreshes the status line, and details stay in `file_watch_list`.

## Configuration

Create `.pi/file-watch.json`:

```json
{
  "watch": [".pi/journal.md"],
  "debounceMs": 500,
  "batchWindowMs": 120000,
  "triggerTurn": true,
  "allowExternalPaths": true,
  "followSymlinks": true
}
```

`batchWindowMs` defaults to `120000` (two minutes). During that window, repeated changes to the same file are coalesced into one final-state change with `change_count`.

`followSymlinks: false` rejects symlinks in the file path, including parent
directories. `allowExternalPaths: false` checks the resolved target against the
workspace even when symlink following is enabled. Cached paths are revalidated
before hashing; a changed target is not read until rediscovery. Use
`file_watch_reload` after replacing a parent-directory link.

`maxBytes` bounds hashing (default `12000`, configurable from `512` to `128000`).
Larger files still emit size and modification time, but omit `hash`; file content
is never injected. Reads are capped at the limit plus one growth-detection byte,
using a no-follow regular-file descriptor. Files that change during hashing,
become unreadable, or disappear omit the hash. Hashing stays synchronous but
bounded; there is no background read to survive reload. Reload/shutdown cancels
pending debounce and batch timers.

Emitted `firewatch_batch` details include `window_start`, `window_end`, and `changes`. Each change may include `path`, `event`, `hash`, `byte_size`, `mtime`, `target`, and `change_count`.
