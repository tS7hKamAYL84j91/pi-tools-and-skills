# ADR 2: TruncatedText limitHit Diagnostic Field

## Status

Accepted

## Context

`TruncatedText` tracked `truncated: boolean` but did not indicate which limit
was hit (bytes vs lines). This made it harder to diagnose why model context
was truncated.

## Decision

Added `limitHit?: "bytes" | "lines"` to `TruncatedText`. The `truncateText`
function sets this field when truncation occurs.

## Consequences

- Diagnostics can distinguish byte-limit truncation from line-limit truncation.
- The field is optional, preserving backward compatibility.
- No consumer currently reads `limitHit`; it's available for future tooling.