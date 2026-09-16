# Directives (comms channel)

- `inbox/` — notes typed by Jim in the dashboard (Directives tab). Each file is JSON:
  `{id, ts, from: "jim", text}`. Written by the dashboard service; delivery only — nothing
  auto-executes. Gravitas watches this directory.
- `replies/` — replies from Gravitas, read by the dashboard. Preferred: JSON files
  `{id, ts, from: "gravitas", re: "<directive id>", text}`. Plain `.txt` / `.md` files
  are also supported.
- Runtime data directory; not committed to git (contents ignored).
