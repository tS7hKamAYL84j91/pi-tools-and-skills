# Agent Hub Zellij Pane

Compact, interactive terminal side pane for Zellij tabs. Shows the tab's lead agent and its namespace helpers from Agent Hub (`~/.pi/agents`).

An opt-in [native Rust index + fixed WASI view](shared/README.md) shares collection
across tabs and has its own opt-in controls. The MCP interface below belongs to
this Node sidebar; it does not require or expose the Rust/WASI owner.

## Usage

```sh
./agent-hub-pane/pi-agents-pane --scope <canonical-lead> [--registry <dir>] [--interval <seconds>] [--once] [--json] [--no-color] [--mcp-config <private-json>]
```

- `--scope <name>`: canonical lead name to display (matches `declared_name` or `name` fallback, plus any agents whose `namespace == scope`).
- `--registry <dir>`: override registry directory (defaults to `~/.pi/agents`).
- `--interval <sec>`: refresh cadence in continuous mode (default: 2 s, range: 0.25..3600). Input and resize handling stay responsive; the interval controls registry refresh, not action validation.
- `PI_AGENTS_PANE_INTERVAL`: env override of the default cadence (0.25..3600); an explicit `--interval` wins, unset or blank keeps the default.
- Startup and steady-state refresh read the registry without spawning Zellij queries. Valid terminal identity enables advisory controls only; actions/active confirmations still revalidate live focus, full pane identity and cwd. Unchanged frames emit nothing; small updates repaint only changed lines.
- `PI_AGENTS_PANE_STARTUP_DELAY`: seconds to pause automatic redraws after the initial frame (default: 20, range: 0..3600; `0` disables). Unset or blank uses the default. Initial interactive controls, keyboard/mouse and resize redraws remain immediate. At expiry the pane refreshes and starts normal polling. One-shot output is not delayed. Set this in the launcher environment; running panes require a restart.
- `--once`: render a single frame and exit.
- `--json`: emit JSON snapshot and exit (implies `--once`).
- `--no-color`: plain text output without ANSI colors.
- `--mcp-config <private-json>`: enable [tab-scoped MCP controls](#tab-scoped-mcp-opt-in); interactive mode only.

Exit codes: `0` success, `2` argument error, `3` registry unreadable.

## Interactive Controls (Zellij)

Footer: `n:new c:close l:lead q:quit` (`n+ c- l:lead q:quit` below 27 columns; read-only fallback: `q:quit`).

- **Select row**: `j` / `k` or Up / Down arrows.
- **Focus agent**: `Enter` or left mouse click. Uniquely targets the agent's pane in this tab/session. Reveals/raises hidden floating panes; focusing a tiled pane hides floating panes while agents continue running.
- **Create agent**: `n`, enter a name, press `Enter` to preview, then `Enter` or `y` to confirm. Starts an interactive `pi --name <name>` floating pane in this tab and project directory using Pi's default configured model. Known Matrix credential environment variables are removed and Matrix is disabled. Custom credential variable names may still be inherited from the Zellij server; do not expose secrets there.
- **Close pane**: `c`, verify pane number in prompt, press `Enter` or `y` within 5 seconds to confirm (`n` cancels). Performs a Zellij pane close.
- **Designate lead**: `l` sets the selected agent as the panel-local lead until exit.
- **Quit**: `q` or `Ctrl-C` exits and restores terminal state.

### Pending navigation

Zellij checks run asynchronously, with one action in flight. While checking,
`n` or selection movement cancels the pending action; `q` quits without waiting
for the metadata deadline. Additional action/confirmation keys are not queued.
Once an action has been sent, cancellation cannot undo it: the pane reports that
it is verifying the receipt. Registry identity, duplicate claims and confirmation
expiry are rechecked after metadata awaits, immediately before dispatch.

An existing modal inspection finishes and is discarded before a fresh action
inspection starts; the two never compete for IPC. Modal-only advisory checks use
`list-tabs --json` plus `list-panes --state --tab`, avoiding Zellij 0.44.1's costly
per-pane process scans. This unescaped table is bounded, anchored to structured
tab metadata and never used to authorize arming/actions or verify success.
Unsupported/ambiguous projections fall back to full JSON.

Arming retains full JSON focus checks. Mutation preflights retain the actual
claimed pane's cwd and identity checks; close/create receipts include unselectable
panes through full JSON. Zellij 0.44.1 has
no per-pane cwd CLI; checking `/proc/<agent-pid>/cwd` instead would not establish
the claimed pane's identity. Full action latency therefore remains distinct from
UI responsiveness and cheap background-check latency.

## Tab-scoped MCP (opt-in)

Agents can use `/skill:create-agent` for the [standing-agent add/remove workflow](../skills/create-agent/SKILL.md).
Removal still requires the human sidebar confirmation described below.

`--mcp-config /absolute/private/sidebar.json` exposes this running sidebar's
operations at `http://127.0.0.1:<port>/mcp`. It requires an interactive Zellij
sidebar. Without the flag, no server, credentials, or extra startup queries are
created. Install repository dependencies with `npm ci` before use.

The config must be an owned `0600` regular, single-link file in an owned `0700`
directory, without symlinked paths. It is read once; restart to change it. Fields
are strict:

```json
{
  "port": 49152,
  "bearerToken": "<64 lowercase hexadecimal characters>",
  "maxPanes": 8
}
```

Generate the token with `crypto.randomBytes(32).toString("hex")` and write it
directly to the private config, not to logs, arguments, or committed files.
`maxPanes` must be 2–32 and counts **all terminal panes in the tab**, including
this sidebar and unregistered shells. The configured limit applies to keyboard
and MCP creation alike; ordinary keyboard-only sidebars retain their 32-pane limit.

Configure the intended Pi sessions in `.pi/mcp.json` or `~/.pi/agent/mcp.json`
with a per-tab entry (example only; no live configuration is installed automatically):

```json
{
  "mcpServers": {
    "hub-sidebar": {
      "url": "http://127.0.0.1:49152/mcp",
      "headers": { "Authorization": "Bearer ${HUB_SIDEBAR_TOKEN}" },
      "exposure": "direct"
    }
  }
}
```

The trusted launcher must supply `HUB_SIDEBAR_TOKEN` matching the private config.
Use a distinct port/token for each tab; do not share a global tab-control token.
The token is an explicit **capability for that sidebar's fixed tab**, not proof
of the calling agent's PID or identity. Any holder can exercise it. Private files
are not an OS security boundary against other same-UID processes. Do not give
this capability to untrusted agents. The named `HUB_SIDEBAR_TOKEN` is removed by
both sidebar New paths and the shared RPC/team child-environment scrub; ordinary
child launches do not automatically delegate it. Explicit trusted gate commands
retain their existing environment opt-out. Custom credential variable names may
still be inherited from the Zellij server; do not expose secrets there. Only loopback POST requests with the bearer token are accepted; browser
origins and unexpected hosts are rejected. No remote listeners or human-relay
credentials are enabled.

| MCP tool | Sidebar operation |
| --- | --- |
| `hub_list_agents` | Up to 32 verified standing agents in the pinned tab, stable IDs, current lead, and `instance_id`; no cwd/session paths or transcripts. |
| `hub_create_agent` | Autonomous **New**, using the same launch path, name/cwd/pane validation, credential scrub, and configured model as the keyboard. |
| `hub_close_agent` | Select the verified target and request human **c then y**; the tool never closes a pane autonomously. |
| `hub_set_lead` | The same panel-local **Lead** designation; no registry, namespace, ownership, or permission changes. |

Create takes `name`; close/lead take `agent_id` from the list. All three also
require `instance_id` from a fresh list and a unique `request_id` (1–128 letters,
digits, dots, underscores, or hyphens). Repeating identical input with the same
request ID returns its original result; changed input is refused. The bounded
256-request cache never evicts IDs during one sidebar lifetime. A restart changes
`instance_id`, so old requests cannot silently replay. There is no automatic retry.

Keyboard and MCP share one in-flight operation slot. Human modal input takes
priority; busy requests are refused, not queued. Delegated creation does not
require keyboard focus, but is pinned to the sidebar's verified startup tab:
moving the sidebar disables MCP actions rather than retargeting them. Keyboard
controls retain their focus and separate-confirmation checks. Existing Pi tool
permission gates still apply. Keyboard cancellation can stop preflight; MCP
cancellation is best-effort and disconnecting is not rollback. After dispatch,
cancellation cannot undo creation, and receipt verification continues. Unknown mutation outcomes inhibit **both** keyboard and MCP mutations.
Inspect actual panes before explicitly recovering/restarting the sidebar.

A `pane_created` response verifies the floating pane, **not** successful Hub
registration or task execution. Its `registration` is `not_yet_verified`; list
again to observe live registration. Created agents are independent interactive
sessions, not parent-owned RPC children, and survive their requesting agent's
exit. Enable Agent Hub in them for registration/messaging. Neither the requester
nor this MCP endpoint supplies arbitrary argv, model overrides, cwd, or tab IDs.
Stopping the sidebar also stops its MCP listener, not the created agents. Use one
sidebar owner per tab; this is not a fleet supervisor or a cross-process transaction
against manual Zellij actions.

## Testing

Fixture snapshot (offline, no live registry access):

```sh
./agent-hub-pane/pi-agents-pane --scope demo --registry "$PWD/tests/fixtures/agent-hub-pane" --once --json
```

Detached Zellij 0.44.1 acceptance test (creates and cleans up its own scratch session):

```sh
node agent-hub-pane/test-agent-pane-zellij.mjs
node agent-hub-pane/test-agent-pane-zellij.mjs --mcp
```

`--mcp` additionally runs a real MCP client against the sidebar in the disposable
Zellij session: authentication, same-tab New and live registration, retries,
foreign-tab refusal, shared Lead/Close controls, capability stripping, and agent
survival after client/sidebar exit. It uses a private temporary token and a fake
`pi` executable; no models, existing sessions, or live settings are touched.

Bounded attached load test: eight Hub panes across eight disposable tabs, four
synthetic output producers (400 lines/s configured, 45-second lifetime), no model
calls. Verifies all panes become interactive, output advances, idle polls launch
no Zellij queries, and input-driven focus/close/create have real pane receipts.
Reports focus latency including receipt polling; this is not a live-user benchmark.

```sh
node agent-hub-pane/test-agent-pane-zellij.mjs --load          # Python stdlib PTY
node agent-hub-pane/test-agent-pane-zellij.mjs --termwright   # native Termwright PTY required
```

Both paths clean up only their generated session. The Termwright path fails
explicitly if its platform-native addon is unavailable; it does not silently
substitute another driver.

The combined Termwright scale test runs **all groups concurrently in one session**:
one Hub with 10 standing fixture agents and ten Hubs with 1–5 each (40 agents,
51 terminal panes total). All groups share one fixture registry. It verifies
scope isolation, full-size rows, keyboard focus in every group, narrow two-line
paging and mouse focus in the dense group, cancellation, and process cleanup.
Display latency is observed through the attached terminal before querying the
focus receipt, avoiding measurement-induced metadata contention. It also holds a
confirmation open across a refresh tick, verifies modal checks avoid full scans,
and times the advisory metadata path separately from arming and action latency.

```sh
node agent-hub-pane/test-agent-pane-scale.mjs
```

Fixtures are lightweight Python processes, not model workers. Registry polling
uses the normal 2-second interval; only the fixture startup redraw delay is
zeroed. The run has a 150-second deadline and never touches existing sessions.

Termwright 0.7.7 officially supports Node 22/24. On this Node 25 ARM64 host its
optional native addon was omitted by `npm ci`; the matching addon can be installed
locally without changing the lockfile or defaults:

```sh
npm install --no-save --ignore-scripts --no-audit --no-fund @termwright/pty-linux-arm64@0.7.7
```
