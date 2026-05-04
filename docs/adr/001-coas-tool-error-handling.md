# ADR 1: CoAS Extension UX Error Handling Pattern

## Status

Accepted

## Context

The pi-coas extension tools threw raw `Error` for user-correctable failures
(e.g. "No workspace selected", "Schedule already exists"). These appeared as
internal tool failures in model context rather than actionable feedback.

## Decision

All tool `execute()` handlers wrap their implementation in try/catch and return
`fail()` from `lib/tool-result.js` for any thrown errors. The catch block
includes relevant parameters in the `details` object to aid agent recovery.

Read-only tools with no parameters (coas_status, coas_doctor, workspace_list,
schedule_list) include no details. Tools with parameters include the relevant
identifiers (selector, taskId, room, name, workspace) for traceability.

## Consequences

- Agents receive structured error messages with `isError: true` and actionable
  details instead of opaque tool-call failures.
- The pattern is consistent across all 10 tool handlers.
- Future error handling changes (logging, metrics, retry) would need to touch
  all handlers, but the variation in `details` per handler makes a shared
  helper low-value.