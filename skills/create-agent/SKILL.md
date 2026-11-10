---
name: create-agent
description: Add or remove independent standing Pi agents through the Agent Hub Zellij sidebar. Use when asked to create_agent, create a standing agent, add an agent pane, or remove a standing agent; not for temporary RPC workers.
---

# Standing agents

Use the running Agent Hub sidebar's tab-scoped MCP controls. Standing agents are
independent interactive Pi sessions, not `spawn_agent` RPC children. They survive
the requester and sidebar exiting. Creating a pane does not configure a fleet
manifest, role, schedule, or restart policy.

## Prerequisites

- Confirm the requested operation and intended tab. Use only an explicitly
  provisioned sidebar MCP connection for that tab.
- Discover the tools by their logical names: `hub_list_agents`,
  `hub_create_agent`, `hub_close_agent`, and optionally `hub_set_lead`. Pi prefixes
  MCP names with the configured server name; use the names actually available.
- If the tools/capability are unavailable, ask the operator to provision them.
  Do not read or distribute tokens, edit live settings, start a replacement
  sidebar, or bypass this boundary with raw Zellij commands.
- For setup and limits, read `../../agent-hub-pane/README.md`, section
  **Tab-scoped MCP (opt-in)**. Resolve that path relative to this skill directory.

## Add a standing agent

1. Call `hub_list_agents` with `{}`. Require `status: "ok"`, no truncation, and
   `mutations_inhibited: false`. Note `instance_id`, existing names, and the lead.
   If the lead/project is unclear, ask before proceeding. `hub_set_lead` changes
   only this sidebar's local designation; it does not change registry ownership.
2. Choose an unused name: 1–64 letters, digits, dots, underscores, or hyphens;
   start with a letter or digit, exclude `..`, and do not reuse the scope name.
3. Call `hub_create_agent` once with a fresh request ID, for example:

   ```json
   { "instance_id": "<from list>", "request_id": "new-reviewer-1", "name": "reviewer" }
   ```

   The sidebar launches an independent floating `pi --name reviewer` in its
   pinned tab and verified lead's working directory, using Pi's configured
   default model. Do not supply arbitrary argv, cwd, model, or tab IDs.
4. `status: "pane_created"` verifies the pane only;
   `registration: "not_yet_verified"` is not proof of a registered or ready agent.
   List again to observe registration. If it is not yet listed, do not create
   another pane; report the pending registration. Agent Hub must be enabled in
   the new session for discovery/messaging.
5. If assigning work was requested, use Agent Hub to discover the registered
   peer and send the authorized task. Creation itself sends no task. Do not use
   `rpc_send` for a standing agent.

## Remove a standing agent

1. List again and match the requested agent to its stable `id`; never infer a
   target from row order or a stale name. If ambiguous, ask. Warn about
   interrupting active work and obtain the user's approval before requesting a
   close.
2. Call `hub_close_agent` with that `agent_id`, the current `instance_id`, and a
   fresh `request_id`:

   ```json
   { "instance_id": "<from list>", "request_id": "close-reviewer-1", "agent_id": "<from list>" }
   ```

3. On `confirmation_required`, tell the human to focus the sidebar, press `c`,
   verify the target/pane, then press `y` within five seconds. This tool only
   selects the target and requests confirmation; it has not closed the pane.
   Never inject confirmation keystrokes, use `kill_agent`, or directly kill the
   process to bypass the human gate.
4. After confirmation, list again and have the human verify the pane is gone.
   Report only what was observed: absence from the list alone does not prove
   process termination. Closing a pane must not delete saved session history.

## Refusals and uncertain results

- Keyboard and MCP share one operation slot. Human dialogs take priority; busy
  requests are refused, not queued. Do not loop or retry automatically.
- An exact retry may reuse the original request ID only with identical arguments
  and the same instance. A new ID is a new operation, not a safe retry.
- After timeout, disconnect, or `uncertain`, inspect/list before doing anything
  else. Never retry a possibly dispatched creation with a new ID. Uncertain
  mutations inhibit further keyboard and MCP mutations; ask the operator to
  inspect panes and recover explicitly.
- A changed `instance_id` invalidates old requests. Moving the sidebar does not
  retarget its capability. Stop and ask the operator if the tab binding fails.
- Respect the configured quota (all terminal panes count), existing permission
  gates, model defaults, and secret boundaries. The capability does not grant
  cross-tab control or human-relay privileges.
