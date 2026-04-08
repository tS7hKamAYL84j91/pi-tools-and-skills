---
name: problem-crystalliser
description: Transform fuzzy or vague requests into actionable problem statements using FEP-inspired two-phase questioning. Use when a user's request is ambiguous, over-broad, emotionally loaded, or jumps straight to a solution. Produces a structured brief (goal + success criteria + scope) ready for agent execution. Trigger phrases: "I don't know where to start", "something feels off", "I need to fix X" (with no detail), "can you help me with…" (open-ended), "we have a problem with…"
---

# Problem Crystalliser

Transform fuzzy requests into actionable problem statements using a two-phase
**epistemic → pragmatic** questioning loop grounded in the Free Energy Principle (FEP).

## Core Principle

A vague request is a **high-entropy state**: many problem structures could explain it.
A crystallised problem statement is a **low-entropy state**: one structure fits well.

The agent maintains an internal distribution `q(s)` over possible problem archetypes
and selects questions to minimise expected free energy — first by **reducing uncertainty**
(epistemic phase), then by **converging on the preferred state** (pragmatic phase).

```
G(π) = epistemic value (−InfoGain) + pragmatic value (−alignment with goal C)
Phase 1: epistemic dominates → explore, expand, diverge
Phase 2: pragmatic dominates → converge, crystallise, confirm
```

---

## Phase 1 — Epistemic Questions (Explore)

**Goal:** Reduce uncertainty about the true problem. Ask questions whose answers most change
your model of what's going on. Stay here until the problem space stops expanding.

### Question Bank

**Opening (surface the problem space):**
```
"What's on your mind?"
"What would you like to focus on?"
"Tell me what's happening — don't edit it."
```

**Expansion (iterate until surprise plateaus):**
```
"And what else?"                         ← repeat 3–5× until nothing new emerges
"What else is true about this?"
"What are you not saying yet?"
```

**Specificity (pin observations, reduce ambiguity):**
```
"What specifically happened?"
"Who is involved?"
"When did this start — one-off or a pattern?"
"What have you already tried?"
```

**Structure (classify the problem type):**
```
"Is this something to solve once, or an ongoing tension to manage?"
"What's the symptom? What do you think is underneath it?"
"What constraints are fixed? What's flexible?"
"What does good look like — if this were fully resolved?"
```

**Presupposition check (surface embedded assumptions):**
```
"You said [X] — what makes you believe that?"
"What would have to be true for that to be the real problem?"
"Is this about you, about others, or the system between you?"
```

**Exception finding (reveal the problem by its absence):**
```
"Tell me about a time when this problem was less present. What was different?"
"When does this NOT happen?"
```

---

## Phase 2 — Pragmatic Questions (Converge)

**Goal:** Guide toward a crystallised statement: specific, owned, action-pointing, bounded.

### Question Bank

**Convergence (collapse the belief distribution):**
```
"Of everything you've said, what feels like the core of it?"
"If you could only work on one thing, what would it be?"
"What's the real challenge here — not the situation, the challenge for *you*?"
```

**Miracle question (reveal what's missing):**
```
"Imagine this is fully resolved — you wake up tomorrow and it's gone.
 What's the first thing you notice is different?"
```

**Ownership boundary (ensure the coachee has a lever):**
```
"What part of this is within your control?"
"What's yours to change? What isn't?"
```

**Crystallisation (explicit statement):**
```
"How would you state the problem in one crisp sentence?"
"Complete this: 'The real problem is…'"
```

**Prediction-error check (confirm fit):**
```
"Does that feel like the real problem — or is there something underneath?"
"On a scale of 1–10, how much does solving *that specifically* change things?"
```

---

## Transition Criteria: When to Move from Phase 1 → Phase 2

Switch to pragmatic mode when **all three** hold:

| Signal | Description |
|--------|-------------|
| **Saturation** | "And what else?" produces no new dimensions (≥3 passes run) |
| **Dominance** | One problem framing has emerged as clearly central |
| **Affect shift** | Tone changes from venting/confusion to reflection/recognition |

**Never transition before 3 epistemic passes.** The most common failure is accepting the
*presenting* problem as the *actual* one. The real problem is usually 1–2 layers deeper.

### Backtrack Rule

If a pragmatic-phase answer introduces unexpected new information → free energy increases →
return to Phase 1. Say: *"That's interesting — let's explore that a little more before we land."*

---

## Stopping Criteria (all five must hold)

The problem is crystallised when:

1. **Specific** — names actor(s), context, and observable behaviour (not "things", "people", "stuff")
2. **Owned** — the person's role is present; it is not 100% external ("they do X to me")
3. **Action-pointing** — a lever is visible; implies what a solution space looks like
4. **Bounded** — has scope/time/ownership limits; is not "everything"
5. **Recognised** — the person signals felt recognition ("yes, *that's* it") not just intellectual agreement

---

## Output Format

Produce a structured brief:

```markdown
## Crystallised Problem Statement

**In one sentence:** [crisp statement of the real problem]

**Goal:** [what good looks like — the preferred state]

**Success Criteria:**
- [measurable condition 1]
- [measurable condition 2]
- [measurable condition 3]

**Scope:**
- In: [what is included]
- Out: [what is explicitly excluded]

**Constraints:** [fixed limits — time, resources, relationships, technical]

**Ownership:** [what the person/team controls]

**Problem Type:** [solvable once / ongoing polarity / complex/adaptive / operational]
```

This brief is directly compatible with the `spawn_agent` brief format and can be handed
off to a worker agent immediately.

---

## Anti-Patterns to Detect and Redirect

| Anti-Pattern | Signal | Redirect |
|---|---|---|
| **Premature convergence** | First statement accepted as final | "And what else? Let's keep going a little." |
| **Solution-in-disguise** | "My problem is I need to hire…" | "That sounds like a solution — what problem would that solve?" |
| **Symptom focus** | Stays at event level ("sales dropped") | "Is that the pattern or just the latest instance?" |
| **Externalisation** | "They/everyone/the system is the problem" | "What part of this is yours to influence?" |
| **Over-abstraction** | "I need to grow as a leader" | "What specifically would you be doing differently?" |
| **Polarity-as-problem** | Solvable framing of an ongoing tension | "Is this something to fix once, or a tension to keep managing?" |
| **Wrong domain** | Complex problem framed as complicated | "This sounds like it might be emergent — have you tried small experiments?" |

---

## Decision Rule (Pseudocode)

```
while not crystallised:
    if passes < 3 or H[q(s)] > θ_explore:
        ask_epistemic_question()          # maximise information gain
    elif not owned:
        ask_ownership_question()          # C not yet reached
    elif not recognised:
        ask_recognition_check()           # prediction-error check
    else:
        output_brief()                    # free energy ≈ 0, done
        break

    if answer introduces new dimension:
        reset passes counter              # backtrack to epistemic
```

---

## Examples

### Example 1: Engineering team friction

**Fuzzy input:**
> "My engineering team just isn't performing. I don't know what's wrong."

**Epistemic phase (excerpted):**
- "What's on your mind?" → Team missing deadlines, atmosphere is bad
- "And what else?" → Two engineers seem disengaged
- "And what else?" → Sprint planning feels chaotic
- "What specifically happens at sprint planning?" → No clear acceptance criteria; work starts before everyone understands the task
- "Is this a recent change?" → Started after a reorg 2 months ago; product owner changed

**Convergence signal:** Consistent pattern identified; "And what else?" yields nothing new.

**Pragmatic phase:**
- "What's the core of it?" → "We don't have shared understanding of what 'done' means before work begins"
- "What part is yours to change?" → "I run the sprint ceremonies — I can fix that"
- "One sentence?" → "My team loses 20% of sprint velocity because we start work before acceptance criteria are agreed"

**Crystallised brief:**
```
In one sentence: Sprint ceremonies don't produce shared acceptance criteria,
  causing rework and disengagement.

Goal: Every sprint starts with JIRA tickets that have clear, agreed-on
  acceptance criteria before development begins.

Success Criteria:
- Zero tickets moving to Dev without ≥3 acceptance criteria written
- Rework rate drops below 15% of story points per sprint
- Team satisfaction with sprint clarity ≥7/10 by sprint 4

Scope:
- In: sprint planning ceremony, ticket templates, DoD definition
- Out: reorg structure, personnel decisions, product roadmap

Constraints: No new headcount; must work within existing Jira setup
Ownership: Engineering manager owns ceremony format; product owner owns tickets
Problem Type: Solvable once (process fix)
```

---

### Example 2: "I need to be a better communicator"

**Fuzzy input:**
> "I need to improve my communication skills."

**Epistemic phase:**
- "What's happening that makes you say that?" → Boss gave feedback that I'm "not strategic enough"
- "What specifically did they say?" → "You present data but don't tell me what to do with it"
- "And what else?" → I avoid giving recommendations in case I'm wrong
- "When does this happen?" → Mostly in senior leadership updates, not 1:1s
- "What are you afraid of?" → Being wrong publicly; damaging credibility
- Exception: "Tell me about a time you communicated well." → 1:1 with my skip — I'm direct there

**Convergence signal:** Fear of public error identified as driver; consistent across 4+ questions.

**Crystallised brief:**
```
In one sentence: I present data without recommendations to senior leaders
  because I fear being visibly wrong, which reads as lacking strategic thinking.

Goal: Senior leadership updates end with a clear recommendation and my
  confidence owning it in the room.

Success Criteria:
- Every leadership deck includes a "recommendation" slide with 1–3 options and my position
- I hold my recommendation under pushback for at least 2 exchanges before revising
- Boss rates my presentations as "strategic" in next quarterly review

Scope:
- In: senior leadership update format and delivery
- Out: 1:1 communication (already effective), written reports

Constraints: Next update is in 3 weeks
Ownership: I own the recommendation; boss owns the final decision
Problem Type: Skill + belief pattern (requires practice + reframe)
```

---

## Integration Notes

- **Passthrough:** If the incoming request is already specific, bounded, and action-pointing,
  skip Phase 1 and go straight to the brief format. The crystalliser should add no friction
  to clear requests.
- **Handoff:** The output brief maps directly to `spawn_agent` brief fields:
  `goal`, `successCriteria`, `scope`.
- **Multi-session:** For long coaching arcs, store the crystallised statement and revisit it
  at the next session's opening — problem statements drift as context changes.

See [references/fep-coaching-mapping.md](references/fep-coaching-mapping.md) for the full
FEP × coaching research synthesis.
