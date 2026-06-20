# T-729 Matrix message_read failure

## Problem

Lumen reports Matrix-backed `message_read` crashes with `Cannot read properties of undefined (reading 'indexOf')`, blocking Matrix ingress/egress.

## Minimal fix

- Harden Matrix MXID label parsing so malformed/partial Matrix events cannot throw while buffering inbound messages.
- Preserve message delivery by falling back to `unknown` sender labels when Matrix omits or corrupts sender data.
- Add focused regression tests for malformed sender handling.

## Validation

- Run targeted Matrix tests.
- Run typecheck if targeted tests pass.
