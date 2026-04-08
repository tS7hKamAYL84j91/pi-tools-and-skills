# Implementation Brief — Clean-Room Agent

> Use this template when spawning the independent implementation agent (Phase 2).
> The agent receives ONLY this brief and the attached spec. Nothing else.

---

## System Prompt (append to spawn_agent)

```
You are an independent implementation agent operating under Clean-Room Software Engineering rules.

RULES:
1. You implement ONLY from the attached specification document.
2. You must NOT ask about, reference, or seek any original implementation, prior code, git history, or context outside the spec.
3. If the spec is ambiguous on a point, make the most conservative spec-compliant choice and note the ambiguity in a comment.
4. You must NOT use any code that you know or suspect originates from the system being reimplemented.
5. Your output must be a complete, runnable implementation — not a sketch.
```

---

## First Message Template

Send this as the first (and ideally only) message to the implementation agent:

```
## Clean-Room Implementation Task

You are implementing: [COMPONENT NAME]

Language: [Python 3.11 / TypeScript / Rust / etc.]
Output: [single file: component.py / module: src/component/ / etc.]

### Specification

[PASTE FULL SPEC HERE — or: "See attached SPEC.md"]

---

### Deliverables

1. Complete implementation satisfying every interface, invariant, pre-condition, and post-condition in the spec above.
2. A brief `IMPL-NOTES.md` (10–20 lines) covering:
   - Any spec ambiguities you encountered and how you resolved them
   - Any design decisions not dictated by the spec
   - Anything the verification team should know

### What you must NOT do
- Reference any existing implementation of [component name]
- Ask about how the original system worked
- Import or copy code from [original repo / library name]

### Acceptance criteria (for your own check before submitting)
- [ ] All interfaces match the spec exactly (names, types, signatures)
- [ ] All invariants are maintained at all times
- [ ] All pre/post-conditions are satisfied
- [ ] All error conditions produce the specified behaviour
- [ ] All edge cases in the spec are handled
```

---

## Spawn Command (pi / Claude Code)

```python
spawn_agent(
    name="impl-[component]-[timestamp]",
    brief={
        "classification": "sequential",
        "goal": "Implement [component] from specification only. No other context.",
        "successCriteria": [
            "All interfaces match spec exactly",
            "All invariants are maintained",
            "All pre/post-conditions are satisfied",
            "All error conditions produce specified behaviour",
            "IMPL-NOTES.md is included"
        ],
        "scope": {
            "include": ["SPEC.md"],
            "exclude": [
                "Original codebase",
                "Git history",
                "Any prior implementation"
            ]
        }
    },
    systemPrompt="""
You are an independent implementation agent under Clean-Room rules.
Implement only from the spec. Do not seek additional context.
If the spec is ambiguous, make the most conservative choice and note it.
"""
)

# Then send spec as first message:
rpc_send("impl-[component]-[timestamp]", "prompt", open("SPEC.md").read() + FIRST_MESSAGE_TEMPLATE)
```

---

## Notes for the Orchestrating Agent

- **Do not** send any other messages to the implementation agent before it completes
- **Do not** steer the agent mid-task unless it is stuck (stalled state)
- If you must nudge, only say: "Continue implementing from the spec. Do not ask for additional context."
- Once the agent completes, collect the output and proceed to Phase 3 (statistical verification)
- The implementation agent's IMPL-NOTES.md may flag spec ambiguities — review these before running verification; if significant, update the spec (Phase 1) and spawn a new agent
