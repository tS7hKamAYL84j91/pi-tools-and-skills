# Statistical Verification Checklist

Use this during Phase 3 to certify the clean-room implementation.

---

## Pre-Verification Setup

- [ ] Spec is finalised (Phase 1 complete, no pending ambiguities)
- [ ] Implementation is complete (Phase 2 deliverables received)
- [ ] IMPL-NOTES.md reviewed — no unresolved spec ambiguities
- [ ] Test harness can generate random inputs matching the spec's input types/constraints
- [ ] All invariants from the spec are encoded as assertions in the test harness
- [ ] All post-conditions from the spec are encoded as assertions
- [ ] All error conditions have explicit test coverage paths

---

## Usage Model Definition

Define the distribution of test inputs before generating them:

| Input dimension | Distribution | Rationale |
|---|---|---|
| [param 1] | [uniform / normal / biased toward edge] | [why this reflects real usage] |
| [param 2] | [distribution] | [rationale] |
| Edge cases | [% of test cases] | [e.g. 10% of tests are at boundary values] |
| Error conditions | [% of test cases] | [e.g. 5% are invalid inputs to test error handling] |

---

## Test Execution

| Step | Done | Notes |
|---|---|---|
| Generate N test cases from usage model | ☐ | N = ___ |
| Run implementation against all test cases | ☐ | |
| Record PASS/FAIL per test case | ☐ | |
| Log any unexpected exceptions (beyond spec'd errors) | ☐ | |
| Calculate pass rate | ☐ | Pass rate = ___ / ___ |
| Calculate 95% confidence interval | ☐ | CI = [___, ___] |

### Confidence interval formula (Wilson score interval)
For n trials with k passes:
```python
import scipy.stats as stats
import math

def wilson_ci(k, n, z=1.96):  # z=1.96 for 95% CI
    p = k / n
    denominator = 1 + z**2 / n
    centre = (p + z**2 / (2*n)) / denominator
    margin = (z * math.sqrt(p*(1-p)/n + z**2/(4*n**2))) / denominator
    return (centre - margin, centre + margin)
```

---

## Reliability Thresholds

| Level | Required pass rate | CI confidence | Typical use |
|---|---|---|---|
| **Basic** | ≥ 99% | 95% | Standard software, internal tools |
| **High** | ≥ 99.9% | 99% | Customer-facing, financial systems |
| **Safety-critical** | ≥ 99.99% | 99.9% | Medical, aerospace, safety systems |

Minimum recommended N per level:
- Basic: N ≥ 300 (for tight CI)
- High: N ≥ 3,000
- Safety-critical: N ≥ 30,000

---

## Invariant Coverage

Confirm each spec invariant was checked on every test case:

| Invariant | Checked in harness | # violations | Pass? |
|---|---|---|---|
| I1: [description] | ☐ | ___ | ☐ |
| I2: [description] | ☐ | ___ | ☐ |
| I3: [description] | ☐ | ___ | ☐ |

---

## Post-condition Coverage

| Operation | Post-condition checked | # violations | Pass? |
|---|---|---|---|
| [op 1] | ☐ | ___ | ☐ |
| [op 2] | ☐ | ___ | ☐ |

---

## Error Condition Coverage

| Error condition | # times triggered | Behaved as specified? |
|---|---|---|
| [condition 1] | ___ | ☐ |
| [condition 2] | ___ | ☐ |

---

## Decision

| Outcome | Criteria | Action |
|---|---|---|
| **CERTIFIED** | Pass rate ≥ threshold AND lower CI bound ≥ threshold AND no catastrophic failures | Accept implementation; produce Certification Record |
| **REJECT — impl** | Pass rate < threshold; spec is clear | Discard implementation; return to Phase 2 with same spec; spawn new agent |
| **REJECT — spec** | Systematic invariant violations; ambiguous spec | Return to Phase 1; clarify spec; then Phase 2 with new agent |
| **REJECT — catastrophic** | Any safety-critical invariant violated even once | Reject immediately; do not continue testing |

---

## Certification Record (fill in when CERTIFIED)

```markdown
## Certification Record

- **Component:** [name]
- **Spec version:** [hash or date]
- **Implementation agent:** [agent name / session id / commit]
- **Test cases:** N = [number]
- **Pass rate:** [k/N] ([percentage]%)
- **95% Confidence interval:** [[lower]%, [upper]%]
- **Reliability level:** Basic / High / Safety-critical
- **Threshold:** [threshold]%
- **Catastrophic failures:** None / [describe]
- **Result:** CERTIFIED ✓ / REJECTED ✗
- **Certified by:** [agent or human name]
- **Date:** [ISO date]
```
