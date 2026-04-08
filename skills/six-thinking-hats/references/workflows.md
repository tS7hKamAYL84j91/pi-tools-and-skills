# Six Thinking Hats — Workflow Reference

---

## Single-Agent Workflow {#single-agent}

One agent runs all six hats sequentially. The key discipline: fully commit to
each hat before moving to the next. Do not blend hats or carry judgements across.

### Step-by-Step Prompt Sequence

Paste each block in sequence, replacing `[PROBLEM]` with the actual problem.

---

**Step 1 — Blue Hat Opening**

```
BLUE HAT — OPENING

Problem: [PROBLEM]

You are the Blue hat facilitator. Do not contribute content on the problem.
Manage the thinking process:

1. Restate the problem in one clear sentence.
2. Define what a successful session outcome looks like.
3. Set the agenda: Blue → White → Red → Yellow → Black → Green → Blue close
   (adjust if there's a reason to change the sequence; state the reason)
4. Identify constraints: time, missing information, key stakeholders.
5. State the single most important question this session must answer.

Label your output: ## 🔵 BLUE HAT — OPENING
```

---

**Step 2 — White Hat**

```
WHITE HAT — FACTS & DATA

Problem: [PROBLEM]

Think only in facts. Tag each fact: [CONFIRMED], [REPORTED], or [ASSUMED].
Also list [MISSING] information needed before a good decision can be made.

1. What do we know for certain?
2. What data or evidence supports each fact?
3. What information is missing?
4. What assumptions are being treated as facts?

Label your output: ## ⬜ WHITE HAT — FACTS & DATA
```

---

**Step 3 — Red Hat**

```
RED HAT — EMOTIONS & INTUITION

Problem: [PROBLEM]

Report feelings. No justification required. Be honest and brief.

1. First instinct (one sentence):
2. What feels right:
3. What feels wrong:
4. Gut feeling on the main options:
5. Instinctive choice (if forced to decide now):

Label your output: ## 🔴 RED HAT — EMOTIONS & INTUITION
```

---

**Step 4 — Yellow Hat**

```
YELLOW HAT — BENEFITS & OPTIMISM

Problem: [PROBLEM]

Think constructively. Every benefit needs brief logical support.

1. Key benefits (with reasoning):
2. Why could this work?
3. Best realistic outcome:
4. Long-term upside:

Label your output: ## 🟡 YELLOW HAT — BENEFITS & OPTIMISM
```

---

**Step 5 — Black Hat**

```
BLACK HAT — RISKS & CAUTION

Problem: [PROBLEM]

Think critically. Build a risk register. This is disciplined caution,
not pessimism.

For each risk: state likelihood (H/M/L), impact (H/M/L), and any early
warning signs.

1. Main risks (risk register format):
2. Critical weaknesses:
3. False assumptions to challenge:
4. Worst realistic outcome:

Label your output: ## ⚫ BLACK HAT — RISKS & CAUTION
```

---

**Step 6 — Green Hat**

```
GREEN HAT — CREATIVITY & ALTERNATIVES

Problem: [PROBLEM]
[Optionally: paste the Black hat risks here as additional input]

Generate new ideas. No judgement during generation.

Standard generation:
1. Alternatives not yet considered:
2. How could the biggest Black hat risk become an opportunity?
3. What constraint could be removed?

PO Provocation (apply at least one):
- Choose a type: REVERSAL / EXAGGERATION / DISTORTION / RANDOM ENTRY
- State the provocation: PO: [...]
- Move forward: "If this were true, what would follow?"
- Harvest: what useful idea does this surface?

Output 5+ concrete ideas. Label each with its source
(standard / reversal / exaggeration / random entry / etc.)

Label your output: ## 🟢 GREEN HAT — CREATIVITY & ALTERNATIVES
```

---

**Step 7 — Blue Hat Closing**

```
BLUE HAT — CLOSING SYNTHESIS

You have the output of all five thinking hats. Synthesise the session.

Do not introduce new content — only draw from the hat outputs above.

1. Key facts (White) — 2–3 bullets
2. Emotional signals to respect (Red) — 1–2 bullets
3. Top 3 benefits (Yellow)
4. Top 3 risks (Black) with any mitigations
5. Top 2–3 creative ideas (Green)
6. Overall recommendation or decision
7. Next action: [WHAT] — Owner: [WHO] — By: [WHEN]
8. Further thinking needed? (if yes: which hat, what question)

Use the output template from references/output-template.md.

Label your output: ## 🔵 BLUE HAT — CLOSING SYNTHESIS
```

---

### Single-Agent Tips

- **Don't skip hats** — even if Red hat feels awkward, running it surfaces signals
  that often reappear as blind spots in the final decision.
- **Black hat before Green** — running risks before creativity means Green hat can
  directly respond to the weaknesses identified. This often produces better ideas
  than a free-form Green pass.
- **Short Red hat is fine** — Red hat doesn't need to be long. Three honest sentences
  outperform a long rationalised emotional analysis.
- **Audit the synthesis** — Blue closing must reference all five hats. If any hat
  is absent from the synthesis, it wasn't genuinely applied.

---

## Multi-Agent Workflow {#multi-agent}

An orchestrating Blue hat agent spawns five parallel hat agents, collects their
outputs, and synthesises. Use for complex decisions where depth in each hat matters.

### Architecture

```
Orchestrator (Blue hat)
├── white-hat-agent   → facts analysis
├── red-hat-agent     → emotional signals
├── yellow-hat-agent  → benefits analysis
├── black-hat-agent   → risk analysis
└── green-hat-agent   → creative alternatives
         ↓ (all respond)
Orchestrator (Blue hat closing synthesis)
     ↓ optional
green-hat-agent-2     → second creative pass using Black hat risks
```

### Orchestrator Procedure

**Phase 1: Setup**

```python
# Orchestrator defines the shared problem brief
PROBLEM = "[full problem statement]"
CONTEXT = "[any relevant background, constraints, stakeholder info]"

BRIEF = f"""
Problem: {PROBLEM}
Context: {CONTEXT}
Your task: Apply your hat's thinking mode fully and produce your section
of the Six Hats analysis. Follow the hat prompt below exactly.
"""
```

**Phase 2: Spawn hat agents**

```python
# Spawn all five hat agents in parallel
spawn_agent("white-hat", task=BRIEF + WHITE_HAT_PROMPT)
spawn_agent("red-hat",   task=BRIEF + RED_HAT_PROMPT)
spawn_agent("yellow-hat",task=BRIEF + YELLOW_HAT_PROMPT)
spawn_agent("black-hat", task=BRIEF + BLACK_HAT_PROMPT)
spawn_agent("green-hat", task=BRIEF + GREEN_HAT_PROMPT)

# Monitor until all complete
# Use rpc_send("white-hat", "get_state") etc. to check
# Use agent_nudge if any agent stalls
```

**Phase 3: Collect and synthesise**

```python
# Collect each agent's output
white_output  = rpc_send("white-hat",  "get_messages")
red_output    = rpc_send("red-hat",    "get_messages")
yellow_output = rpc_send("yellow-hat", "get_messages")
black_output  = rpc_send("black-hat",  "get_messages")
green_output  = rpc_send("green-hat",  "get_messages")

# Optional: spawn second Green pass with Black hat risks as input
spawn_agent("green-hat-2", task=BRIEF + GREEN_HAT_PROMPT + f"""
Additional input from Black hat analysis:
{black_output}
Use the Black hat risks explicitly: for each risk, generate at least
one creative idea that neutralises or exploits it.
""")

# Run Blue hat closing synthesis on all collected outputs
SYNTHESIS_PROMPT = f"""
BLUE HAT — CLOSING SYNTHESIS

You have received the following hat analyses:

## WHITE HAT
{white_output}

## RED HAT
{red_output}

## YELLOW HAT
{yellow_output}

## BLACK HAT
{black_output}

## GREEN HAT
{green_output}

Synthesise using the Blue hat closing prompt. Produce the final
structured output document (references/output-template.md format).
"""
```

**Phase 4: Cleanup**

```python
# Kill hat agents when synthesis is complete
kill_agent("white-hat")
kill_agent("red-hat")
kill_agent("yellow-hat")
kill_agent("black-hat")
kill_agent("green-hat")
# kill_agent("green-hat-2")  # if used
```

### Multi-Agent Tips

- **Give agents the full context** — each agent only sees its own hat prompt;
  include all relevant background in the shared BRIEF.
- **Check agent state before synthesis** — confirm all five agents have finished
  before running Blue closing. Use `rpc_send(name, "get_state")`.
- **Nudge stalled agents** — use `agent_nudge` if `agent_status` reports stalled.
- **Second Green pass is high-value** — running Green hat a second time with Black
  hat risks as explicit input often produces the best creative ideas of the session.
- **Orchestrator is Blue hat throughout** — the orchestrator should not add its own
  content analysis. Its job is coordination and synthesis only.

### Spawn Agent Parameters for Hat Agents

```python
# Recommended spawn parameters for hat agents
spawn_agent(
    name="[hat]-hat-agent",
    brief={
        "classification": "sequential",
        "goal": "Apply [hat] hat thinking to the problem and produce analysis",
        "successCriteria": [
            "All hat prompt questions answered",
            "Output clearly labelled with hat name",
            "No mixing of hat modes"
        ],
        "scope": {"include": ["problem domain"]}
    },
    tools=["read", "bash"]  # restrict to what's needed
)
```

---

## Workflow Selection Guide

| Situation | Recommended Workflow |
|-----------|---------------------|
| Quick decision (< 15 min) | Single-agent, compressed prompts |
| Standard decision analysis | Single-agent, full sequence |
| Complex, high-stakes decision | Multi-agent, full sequence + second Green |
| Team with conflicting views | Multi-agent (each hat represents a genuine perspective) |
| Agent is stuck / looping | Single-agent, Black + Green only |
| Evaluating a proposal | Single-agent, White + Yellow + Black + Blue |
| Pure brainstorm / ideation | Single-agent, Green hat only with extended PO |

---

## Integration with Other Skills

### With planning skill
Run a Six Hats pass during PLAN.md review when:
- Tasks have been stale for 2+ cycles
- A major decision point is reached
- The current plan feels too narrow

Use Black hat to audit the plan, Green hat to generate alternatives to stalled approaches.

### With research-expert skill
- White hat surfaces research gaps → feeds the research query
- Green hat's random entry generates novel search terms across adjacent fields
- Challenge technique (from Green hat) exposes research framing assumptions

### With red-team skill
- Black hat's risk register complements threat modelling
- Green hat's Intermediate Impossible (`PO: the system attacks itself`) surfaces novel attack vectors
- OPV technique (see REPORT.md §2.8) models attacker perspectives within Red hat
