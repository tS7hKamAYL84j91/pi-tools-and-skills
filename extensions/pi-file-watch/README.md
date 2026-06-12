# pi-file-watch

Small configurable watcher for explicitly listed files.

## What it does

- Watches only configured file paths with `node:fs.watch` and `recursive: false`.
- Debounces file-system events, then batches notifications to reduce autosave noise.
- Emits metadata-only `firewatch_batch` messages; it does not inject file contents.
- Allows symlink or external workspace targets by config.
- Provides `/file-watch`, `file_watch_list`, and `file_watch_reload`.

## What this does NOT do

- No recursive discovery or scans.
- No file writes or state files.
- No automatic path creation.
- No shell execution.
- No file-body injection; agents should use read tools when content is needed.

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

Emitted `firewatch_batch` details include `window_start`, `window_end`, and `changes`. Each change may include `path`, `event`, `hash`, `byte_size`, `mtime`, `target`, and `change_count`.
