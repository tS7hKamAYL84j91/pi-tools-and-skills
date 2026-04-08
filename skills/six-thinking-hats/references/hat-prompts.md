# Hat Prompts — Extended Reference

Extended prompts with worked examples for each hat. Load this file when deeper
guidance is needed beyond the concise prompts in SKILL.md.

---

## 🔵 Blue Hat — Extended

Blue hat is the **thinking about thinking** hat. It does not contribute content
on the problem itself — it manages the thinking process.

### Opening questions (extended)
- What is the real problem here (vs. the presenting symptom)?
- Who needs to be part of this thinking?
- What do we already know, and what would change our decision?
- How much time and effort is proportionate to this decision?
- What is the risk of getting this wrong?

### Mid-session interventions
Blue may call a time-out and redirect at any point:

```
BLUE HAT — MID-SESSION REDIRECT

We have spent [X] on [hat]. I am redirecting to [hat] because:
[reason — e.g., "we have enough risk analysis; we need solutions now"]

Switching to: [hat prompt]
```

### Closing checklist
- [ ] Every hat has been genuinely applied (not just labelled)
- [ ] A concrete next action is named with owner and deadline
- [ ] Unresolved tensions are explicitly noted, not glossed over
- [ ] Any further thinking needed is scoped and assigned

---

## ⬜ White Hat — Extended

White hat is the **neutral information** hat. It strips away opinion and
extracts only what is known or knowable.

### Fact quality levels
When listing facts, tag each with a confidence level:

| Tag | Meaning |
|-----|---------|
| `[CONFIRMED]` | Verified by reliable source |
| `[REPORTED]` | Stated by a source; not independently verified |
| `[ASSUMED]` | Treated as fact; should be verified |
| `[MISSING]` | Needed but not yet available |

### Example White hat output (API decision)

```
⬜ WHITE HAT — FACTS & DATA

Problem: Whether to migrate from REST to GraphQL for our public API.

Confirmed facts:
- [CONFIRMED] Current REST API has 47 endpoints (from API registry)
- [CONFIRMED] P95 response time is 340 ms (from monitoring dashboard)
- [CONFIRMED] 3 of our top 5 clients have requested GraphQL support
- [REPORTED] Competitor launched GraphQL API in Q3 2025

Data gaps:
- [MISSING] Current REST API client satisfaction scores
- [MISSING] Engineering effort estimate for migration
- [MISSING] Whether clients want GraphQL or just faster responses

Assumptions to verify:
- [ASSUMED] GraphQL would reduce over-fetching for our clients
- [ASSUMED] Our team has sufficient GraphQL expertise
```

---

## 🔴 Red Hat — Extended

Red hat legitimises emotional input without requiring it to be defended. Many
bad decisions happen because feelings are smuggled in disguised as logic. Red
hat brings them into the open cleanly.

### When Red hat is most valuable
- When there is strong intuitive resistance that cannot yet be articulated
- When there is unexpected enthusiasm that needs surfacing
- When a decision "feels right" but the logic is weak (or vice versa)
- When team dynamics are creating unstated emotional tensions

### Prompt variant — rapid gut-check (fast sessions)
```
RED HAT — GUT CHECK (30 seconds)

One word that captures the emotional reaction: [word]
One sentence expanding on it: [sentence]
Instinctive go/no-go: [GO | NO-GO | UNCERTAIN]
```

### Example Red hat output

```
🔴 RED HAT — EMOTIONS & INTUITION

Problem: Migrating to GraphQL.

First instinct: Nervous excitement — feels like the right long-term move
  but the timing feels rushed.
Feels right: The three clients asking for it are our most strategic accounts.
Feels wrong: We've never done a migration of this scale; it feels bigger than
  we're admitting in the planning docs.
Gut feeling on options: 
  - Full migration: exciting but scary
  - Hybrid approach: feels like a compromise that pleases no one
  - Stay on REST: feels like falling behind
Emotional risk: Fear of committing to something we can't complete well.
Instinctive choice: Hybrid, but only if we can define a real endpoint.
```

---

## 🟡 Yellow Hat — Extended

Yellow hat requires **constructive logic** — it is not cheerleading. Every
benefit should have a "because" attached. Yellow hat builds the case for why
something could work.

### Steelmanning prompt variant
For decisions under heavy Black hat pressure, use this extended Yellow:

```
YELLOW HAT — STEELMAN

The Black hat has identified serious risks. Steelman the proposal despite them:

1. Assume the risks are manageable. What is the residual case for proceeding?
2. What evidence (from analogous situations) suggests this can succeed?
3. What would have to be true for this to be the right decision?
4. If a trusted expert said "this is a great idea", what might they be seeing
   that we are missing?
```

### Example Yellow hat output

```
🟡 YELLOW HAT — BENEFITS & OPTIMISM

Problem: Migrating to GraphQL.

Key benefits:
1. Client retention: our three largest clients have explicitly asked for it;
   meeting their needs reduces churn risk significantly.
2. Developer experience: GraphQL's typed schema and introspection tools
   reduce onboarding time for new API consumers.
3. Reduced over-fetching: mobile clients currently fetch 3–5x more data than
   needed; GraphQL would cut bandwidth and latency for them.
4. Ecosystem momentum: tooling, libraries, and talent are all accelerating;
   early investment compounds.

Why it could work: Our API surface is well-documented and the team has two
  engineers with prior GraphQL experience.

Best realistic outcome: Within 12 months, top clients are on GraphQL, REST
  remains available for legacy consumers, and new feature development is faster.

Long-term upside: GraphQL becomes the foundation for a future partner API
  programme currently blocked by REST's rigidity.
```

---

## ⚫ Black Hat — Extended

Black hat is the **most overused hat in unstructured thinking** (criticism
without method) and the **most underused hat in optimistic groups** (groupthink
silences caution). In Six Hats, Black gets its full time — but only its time.

### Risk register format

```
| Risk | Likelihood | Impact | Notes / Early Warning Signs |
|------|-----------|--------|------------------------------|
| [risk] | H/M/L | H/M/L | [what to watch for] |
```

### Pre-mortem variant
For high-stakes decisions, add a pre-mortem pass inside Black hat:

```
BLACK HAT — PRE-MORTEM

It is [DATE + 18 months]. The project has failed badly.
What went wrong? Write the failure narrative in past tense:

"The migration failed because..."

From that narrative, extract:
1. The single most likely root cause
2. The two warning signs we should have acted on earlier
3. The decision point where we should have pivoted
```

### Example Black hat output

```
⚫ BLACK HAT — RISKS & CAUTION

Problem: Migrating to GraphQL.

Risk register:
| Risk | Likelihood | Impact | Notes |
|------|-----------|--------|-------|
| Migration drags on, REST+GraphQL run in parallel indefinitely | H | H | Classic "big rewrite" trap |
| Team GraphQL expertise is shallower than assumed | M | H | Only 2 of 12 engineers have shipped GraphQL in production |
| Breaking changes to REST clients during migration | M | H | Requires a freeze period; check client SLAs |
| GraphQL N+1 query problem hits performance at scale | M | M | Requires DataLoader patterns from the start |
| Client demand was for speed, not GraphQL specifically | L | H | Validate this assumption with client calls before committing |

Critical weaknesses:
- No migration estimate exists; scope is unknown
- No REST deprecation plan means indefinite dual maintenance

Worst realistic outcome: Two-year migration leaves us maintaining both APIs
  with 60% of engineering capacity locked in the transition.
```

---

## 🟢 Green Hat — Extended {#green-hat-extended}

Green hat is where lateral thinking techniques are explicitly applied. The other
hats create the space; Green hat uses it.

### Standard generation sequence

1. **Alternatives scan:** what approaches haven't been named yet?
2. **Risk-to-opportunity:** take each Black hat risk and ask "how could this become an advantage?"
3. **Constraint challenge:** list the constraints assumed in the current approach; challenge each one
4. **PO provocation:** apply at least one (see types below)
5. **Random entry:** if stuck after PO, apply random entry

### PO Types — Worked Examples

#### Reversal
```
Problem: How to speed up API documentation updates.
PO: The documentation writes itself.
Forward movement: If docs wrote themselves, they'd be generated from code.
  → Auto-generated docs from OpenAPI/GraphQL schema
  → Changelog entries auto-written from diff
  → AI-drafted summaries from PR descriptions
Harvested idea: Set up schema-to-docs pipeline; human editor reviews, not writes.
```

#### Exaggeration
```
Problem: How to reduce meeting overhead.
PO: Every meeting lasts exactly 5 seconds.
Forward movement: In 5 seconds you can only say one thing.
  → What is the single thing each meeting must decide?
  → Write that decision down before the meeting starts
  → If the answer is already known, cancel the meeting
Harvested idea: Pre-meeting decision brief; meeting only happens if brief
  is incomplete or disputed.
```

#### Distortion
```
Problem: How to improve onboarding for new engineers.
PO: The new engineer onboards the team, not the other way round.
Forward movement: The new engineer brings fresh eyes; they see what's broken
  before they're normalised to it.
  → First week task: write a "confusion log" of everything that was unclear
  → Confusion log becomes onboarding doc improvement backlog
Harvested idea: Structured first-week audit; new hires improve the docs as
  they go through them.
```

#### Random Entry
```
Problem: How to make sprint planning less painful.
Random word: bridge

Attributes of "bridge":
1. Spans a gap between two fixed points
2. Built in sections that connect
3. Has a load limit — collapses if overloaded
4. Bidirectional — traffic flows both ways
5. Requires foundations on both sides before spanning

Forced connections:
1. "Spans a gap" → sprint planning spans the gap between backlog and delivery;
   what are the fixed points? → clarify start state and end state explicitly first
2. "Load limit" → sprints collapse when overloaded; impose a hard WIP limit
3. "Bidirectional" → information should flow both up (to stakeholders) and
   down (to engineers); current planning is one-directional
4. "Foundations on both sides" → sprint planning fails when backlog items aren't
   ready; enforce a "ready" definition before items can enter sprint

Harvested ideas:
- Add a "ready" gate to the backlog refinement process
- Make WIP limit explicit and enforced in sprint planning
- Add a stakeholder update step at the end of planning (bidirectional flow)
```

### When Green hat is stuck

If standard generation and one PO provocation haven't produced anything new,
apply the **random entry** technique with a word from a completely unrelated
domain (nature, architecture, cuisine, geology). The more unrelated, the better.

If still stuck, switch to the **Concept Fan**:
1. Name the current approach (the "how")
2. Abstract one level: what concept does this serve?
3. Abstract again: what goal does that concept serve?
4. Fan out alternatives at each level before returning to Green hat generation
