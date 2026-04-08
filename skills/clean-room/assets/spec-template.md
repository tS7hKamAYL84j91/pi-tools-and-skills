# Formal Specification: [Component Name]

> **Clean-Room Spec v[1.0] — [DATE]**
> This document contains only functional specification. No implementation details, no algorithms, no references to existing code.

---

## 1. Purpose

One paragraph: what this component does and why it exists. Observable behaviour only.

---

## 2. Scope

### In Scope
- [List what this component IS responsible for]

### Out of Scope (Non-requirements)
- [List what this component explicitly does NOT do — be specific]
- [These boundaries are as important as the requirements]

---

## 3. Interfaces

### 3.1 Inputs

| Parameter | Type | Constraints | Description |
|---|---|---|---|
| `param_name` | `type` | `constraint (e.g. > 0, non-empty)` | What it represents |

### 3.2 Outputs

| Return / Output | Type | Constraints | Description |
|---|---|---|---|
| `result_name` | `type` | `constraint` | What it represents |

### 3.3 Operations / Methods

```
operation_name(param: Type, ...) → ReturnType
```

Describe each operation in one sentence — what it does, not how.

### 3.4 Side Effects

List any observable side effects (state changes, I/O, external calls). If none: "None."

---

## 4. Data Structures

Define the logical shape of all key entities. Use pseudo-type notation, not language-specific syntax.

```
EntityName {
  field_name: Type          # description and constraints
  other_field: Type         # description and constraints
}
```

---

## 5. Invariants

Properties that must hold at all times, regardless of operation order.

- **I1:** [Always-true property, e.g. "buffer size is always in [0, capacity]"]
- **I2:** [Always-true property]
- **I3:** ...

Invariants are checked in Phase 3 verification for every test case.

---

## 6. Pre-conditions

Conditions that must be true **before** each operation is called. If a pre-condition is violated, behaviour is unspecified (caller error).

| Operation | Pre-condition |
|---|---|
| `operation_name` | [What must be true before calling] |
| `other_operation` | [What must be true before calling] |

---

## 7. Post-conditions

Conditions that must be true **after** each operation completes successfully.

| Operation | Post-condition |
|---|---|
| `operation_name` | [What must be true after the call, in terms of inputs and return value] |
| `other_operation` | [What must be true after the call] |

---

## 8. Error Conditions

| Condition | Required Behaviour |
|---|---|
| [Describe the error condition] | [What the component must do — raise, return error value, log, etc.] |
| [Empty input] | [e.g., raise ValueError with message "..."] |

---

## 9. Edge Cases

Explicitly enumerate edge cases the implementor must handle:

- [ ] Empty / zero / null inputs
- [ ] Maximum / overflow values
- [ ] Concurrent access (if applicable)
- [ ] [Domain-specific edge case 1]
- [ ] [Domain-specific edge case 2]

---

## 10. Examples (Observable Behaviour)

Concrete input → output pairs that illustrate the spec. These are not test cases — they are specification illustrations.

```
Input:  [describe input]
Output: [describe expected output]
Reason: [which invariant/post-condition this illustrates]
```

```
Input:  [edge case]
Output: [expected output]
Reason: [which error condition this covers]
```

---

## 11. Spec Certification (IP Protection Mode only)

> Reviewed by: [name / role]
> Date: [date]
> Certification: This specification contains no copyrighted expression from the original system. It documents only functional behaviour, interfaces, and observable properties.

---

## Spec Metadata

| Field | Value |
|---|---|
| Component | [name] |
| Version | [e.g. 1.0] |
| Author | [who wrote the spec] |
| Date | [ISO date] |
| Status | Draft / Under Review / Final |
| Reliability target | Basic (99%) / High (99.9%) / Safety-critical (99.99%) |
