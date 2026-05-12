# ADR 016: Panopticon Agents Overlay Direct Messaging

Status: Accepted

## Context

The `/agents` overlay originally provided status, selection, and detail views for
visible peer and spawned agents. Users sometimes need to contact a spawned agent
immediately from that detail context without copying the agent name into `/send`
or asking the model to call `agent_send`.

The existing panopticon messaging path already provides agent-to-agent delivery
through the Maildir-backed agent transport. Replies are surfaced through the
normal pending-message notification and `message_read` flow.

## Decision

The `/agents` detail overlay may initiate a direct human-authored message to a
visible peer/spawned agent.

The overlay depends on an injected `AgentMessageSender` port bundled in
`AgentOverlayDeps`. UI code does not import the concrete Maildir transport and
does not route through slash-command parsing. The extension entry point wires the
sender port to the existing agent transport using the same sender identity helper
used by other panopticon messaging paths.

The overlay is outbound only. It shows messages sent from the current overlay
session plus delivery status or errors. Inbound replies continue to arrive through
existing unread-message notifications and `message_read`; the overlay does not
add a second receive loop or persistence model.

Before each send, the selected display name is resolved again against the current
visible registry records so stale or hidden recipients produce a visible overlay
error instead of silently targeting an old record.

## Consequences

- `/agents` remains a lightweight overlay, but is no longer read-only; it can
  initiate peer communication.
- `/send` and `agent_send` remain independent entry points that share the same
  lower-level transport semantics rather than sharing command-handler code.
- No new messaging transport, mailbox format, or chat transcript persistence is
  introduced.
- Users must read replies through the existing unread-message flow, avoiding a
  live-chat expectation and keeping inbound handling centralized.
- Send failures and stale-recipient cases are visible in the overlay.
