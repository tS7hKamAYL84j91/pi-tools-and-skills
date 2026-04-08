---
name: clean-room
description: Specification-first development using IBM Cleanroom Software Engineering methodology. Use when building safety-critical systems, re-implementing proprietary software (IP protection), or when formal correctness and high reliability are required. Separates specification, independent implementation, and statistical verification into isolated phases with independent agents. Also covers the two-team Chinese-wall technique for IP-safe reimplementation.
---

# Clean-Room Skill

Implements IBM's Cleanroom Software Engineering (CSE) methodology adapted for AI agent workflows.

**Core principle:** Separate *what a system does* from *how it is implemented*, and enforce that separation rigorously. No implementation agent ever sees the original codebase, problem discussion, or prior implementation.

---

## Two Modes

| Mode | Goal | Use When |
|---|---|---|
| **Reliability Engineering** | Near-zero-defect software | Safety-critical, high-stakes, certified systems |
| **IP Protection** | Provably independent reimplementation | Replacing proprietary code, open-source compatibility layers, competitive reimplementation |

Both modes follow the same four-phase workflow. IP Protection adds a legal review gate at the end of Phase 1.

---

## When to Use

Use the clean-room skill when any of these are true:

- The component handles money, health, safety, or security-critical data
- You need to reimplement proprietary software without copyright exposure
- A previous implementation has accumulated too many defects to repair incrementally
- You need a *certifiable* reliability statement (confidence interval + MTTF), not just "tests pass"
- You want two independent implementations to cross-check each other
- The spec is well-understood but the implementation is complex enough to benefit from formal reasoning

Do **not** use clean-room for rapid prototyping, experiments, or components that change faster than specs can be written.

---

## Workflow Overview

```
Phase 1: SPECIFICATION       ← You (or spec team) write the formal spec
         ↓
      [IP mode: legal review gate]
         ↓
Phase 2: IMPLEMENTATION      ← Independent agent, spec only, no other context
         ↓
Phase 3: VERIFICATION        ← Statistical testing against spec invariants
         ↓
Phase 4: CERTIFICATION       ← Accept or reject based on confidence threshold
```

---

## Phase 1: Specification

**Goal:** Produce a formal spec that fully characterises *what* the component does — interfaces, data structures, invariants, pre/post-conditions — with zero implementation details.

**Do:**
- Define every external interface (inputs, outputs, types, units)
- State all invariants (properties that must always hold)
- Write pre-conditions for every operation (what must be true before)
- Write post-conditions for every operation (what must be true after)
- List all error/edge conditions and their required behaviour
- Declare explicit **non-requirements** (what this component does NOT do)

**Do not:**
- Mention algorithms, data structures, or implementation approaches
- Reference existing code or prior implementations
- Include "how" — only "what" and "when"

**Template:** See [`assets/spec-template.md`](assets/spec-template.md)

**Box Structure Method (optional formalism):**
- **Black Box** — observable behaviour from outside (stimulus → response)
- **State Box** — state transitions (pre-state + stimulus → post-state + response)
- **Clear Box** — control structure that realises the state box (nearest to implementation; still no code)

Use as much formalism as the stakes warrant. For most agent tasks, a well-structured Markdown spec with typed interfaces and explicit invariants is sufficient.

### IP Protection Gate

If using IP Protection mode, after writing the spec:
1. Review the spec with a lawyer (or explicitly self-certify) that it contains no copyrighted expression — only functional facts
2. Document: *"Spec reviewed [date]. No implementation-specific expression retained."*
3. Only then pass the spec to the implementation agent

---

## Phase 2: Independent Implementation

**Goal:** A fresh agent implements the spec with zero knowledge of the original system, prior code, or problem context beyond what the spec states.

**How to spawn the implementation agent:**

```bash
# Use spawn_agent with a strict brief
spawn_agent --name "impl-agent" --brief '{
  "classification": "sequential",
  "goal": "Implement the component described in SPEC.md. You have only the spec. Do not ask for additional context.",
  "successCriteria": ["All interfaces match the spec exactly", "All invariants are maintained", "All pre/post-conditions are satisfied"],
  "scope": {"include": ["SPEC.md"]}
}'
```

Then send the spec as the first and only message:

```
rpc_send impl-agent prompt "$(cat SPEC.md)"
```

**Critical rules for the implementation agent:**
- Receives the spec document only — no other files, no chat history
- Must not ask "what was the original implementation?" — if something is unclear, they note the ambiguity and make the most conservative spec-compliant choice
- Must not look at git history, related code, or any prior context
- Implementation language and runtime may be specified in the spec; if not, agent chooses the most appropriate

**Brief template:** See [`assets/impl-brief-template.md`](assets/impl-brief-template.md)

---

## Phase 3: Statistical Verification

**Goal:** Certify correctness probabilistically by sampling from the input space and checking every output against the spec invariants. This is not exhaustive testing — it is a statistical experiment.

**Verification process:**

```
1. Define the usage model
   - What are the typical input distributions?
   - What are the edge-case frequencies?
   - (For formal CSE: model as a Markov chain over input sequences)

2. Generate N random test cases from the usage model
   - N ≥ 100 for basic certification
   - N ≥ 1000 for high-reliability certification

3. For each test case:
   a. Check pre-conditions are satisfied (valid input)
   b. Run the implementation
   c. Check ALL post-conditions hold
   d. Check ALL invariants hold
   e. Record: PASS or FAIL

4. Calculate:
   - Pass rate = PASS / N
   - 95% confidence interval for the true pass rate
   - Estimated MTTF (if failure rate > 0)

5. Accept or reject:
   - Basic:      pass rate ≥ 99% with 95% confidence
   - High-rel:   pass rate ≥ 99.9% with 99% confidence
   - Safety-crit: pass rate ≥ 99.99% with 99.9% confidence
```

**For AI agent verification**, use property-based testing tools:

```python
# Python / Hypothesis
from hypothesis import given, settings
from hypothesis import strategies as st

@given(st.from_type(InputType))
@settings(max_examples=1000)
def test_spec_invariants(input):
    # Pre-condition check
    assume(pre_condition(input))
    result = implementation(input)
    # Post-condition and invariant checks
    assert post_condition(input, result)
    assert invariant(result)
```

```bash
# Shell-based for simple specs
for i in $(seq 1 1000); do
  INPUT=$(python3 -c "import random; print(generate_random_input())")
  OUTPUT=$(./implementation "$INPUT")
  python3 -c "check_invariants('$INPUT', '$OUTPUT') or exit(1)"
done
```

**Checklist:** See [`assets/verification-checklist.md`](assets/verification-checklist.md)

---

## Phase 4: Certification

**Accept** the implementation if:
- Statistical pass rate meets the threshold for the chosen reliability level
- No catastrophic failures (invariant violations in critical paths)
- All error-condition behaviours were exercised and behaved as specified

**Reject** the implementation if:
- Pass rate falls below threshold → return to Phase 2 (new independent agent, same spec)
- Systematic invariant violations suggest a spec ambiguity → return to Phase 1 to clarify the spec
- Do **not** patch the rejected implementation — the clean-room principle requires a fresh start

**Certification artefact** (record):
```markdown
## Certification Record
- Component: <name>
- Spec version: <hash/date>
- Implementation: <agent-id or commit>
- Test cases: N=1000
- Pass rate: 99.7% (95% CI: [99.1%, 100%])
- Threshold: 99%
- Result: CERTIFIED ✓
- Date: <date>
```

---

## IP Protection Mode: Chinese Wall

Used specifically when you need a provably independent reimplementation (e.g., open-source compatibility, competitive reimplementation, legacy replacement).

```
Team A (Reverse Engineers / Analysts)
  └── Examine original system
  └── Document ONLY: what it does, its interfaces, its observable behaviour
  └── NO source code, NO implementation details pass through

       ↓ LEGAL REVIEW GATE ↓
       Lawyer or explicit self-certification:
       "This spec contains no copyrighted expression"

Team B (Implementors — independent agents)
  └── Receive the reviewed spec ONLY
  └── Have never seen the original system
  └── Implement from scratch
  └── Final output is independently created → strong copyright defence
```

**For AI agents**, "Team A" and "Team B" must be separate agent sessions with no shared context. Do not use `follow_up` or continue the same conversation — spawn a genuinely new agent with only the spec.

**Does NOT protect against patent infringement** — only copyright.

---

## Complete Example

### Scenario: Reimplement a rate-limiter

**Phase 1 — Spec (excerpt):**
```markdown
## Component: TokenBucketRateLimiter

### Interface
- `allow(key: str, tokens: int = 1) → bool`
- `reset(key: str) → None`

### Parameters
- `capacity: int` — max tokens in bucket (> 0)
- `refill_rate: float` — tokens added per second (> 0)

### Invariants
- I1: bucket[key] is always in [0, capacity]
- I2: allow() never grants more than capacity tokens in any 1/refill_rate window

### Pre-conditions
- allow(): tokens > 0; key is non-empty string
- reset(): key is non-empty string

### Post-conditions
- allow(): returns True iff bucket[key] ≥ tokens before call; decrements bucket by tokens if True
- reset(): bucket[key] == capacity after call

### Non-requirements
- Does not persist state across process restarts
- Does not support distributed/shared state
```

**Phase 2 — Spawn implementation agent:**
```bash
spawn_agent --name "ratelimiter-impl" --task "Implement only from the attached spec."
rpc_send ratelimiter-impl prompt "$(cat rate-limiter-spec.md)

Implement this component in Python. Output a single file: rate_limiter.py.
You have only this spec. Do not request additional context."
```

**Phase 3 — Verify:**
```bash
python3 -m pytest tests/test_rate_limiter_statistical.py \
  --hypothesis-seed=0 -x -q
# Runs 1000 random scenarios; checks I1, I2, all post-conditions
```

**Phase 4 — Certify:**
```
Pass rate: 1000/1000 (100%)
95% CI: [99.6%, 100%]
Threshold: 99%
Result: CERTIFIED ✓
```

---

## References

- Mills, Dyer, Linger (1987). "Cleanroom Software Engineering." *IEEE Software* 4(5).
- Linger & Trammell (1996). *SEI Cleanroom Reference Model* (CMU/SEI-96-TR-022).
- Prowell et al. (1999). *Cleanroom Software Engineering: Technology and Process*. Addison-Wesley.
- *NEC Corp. v. Intel Corp.* (1990) — clean-room IP defence precedent.
- *Sony v. Connectix Corp.*, 203 F.3d 596 (9th Cir. 2000) — reverse engineering for interoperability.
