# pi-file-watch

Small configurable watcher for explicitly listed journal files or directories.

## What it does

- Watches only configured paths with `node:fs.watch` and `recursive: false`.
- Debounces change notifications.
- Allows symlink or external workspace targets only when each path opts in.
- Provides `/file-watch`, `file_watch_list`, and `file_watch_reload`.

## What this does NOT do

- No recursive discovery or scans.
- No file writes or state files.
- No automatic path creation.
- No shell execution.

## Configuration

Set `PI_FILE_WATCHER_CONFIG` to JSON before starting pi:

```json
{
  "enabled": true,
  "paths": [
    { "path": ".pi/journal.md" },
    { "path": "../shared/journal.md", "allowExternal": true },
    { "path": "journal-link.md", "allowSymlink": true }
  ],
  "debounceMs": 250,
  "cooldownMs": 5000,
  "notifyMode": "status"
}
```

`notifyMode` may be `status`, `widget`, `followUp`, or `off`.
