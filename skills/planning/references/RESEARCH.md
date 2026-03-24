# Research: Manus Context Engineering Principles

This document compares the implementation of the `planning` skill with the principles outlined in the Manus engineering blog post and foundational academic research in autonomous agents.

## Core Principles & Implementation Alignment

### 1. Filesystem as Context (Unlimited Memory)
**Manus Principle:** "Context Window = RAM (volatile, limited), Filesystem = Disk (persistent, unlimited). Anything important gets written to disk."
**Implementation:**
- The skill enforces a "3-File Pattern": `PLAN.md`, `PROGRESS.md`, `KNOWLEDGE.md`.
- These files serve as the "Disk" memory, allowing the agent to offload information from its limited context window.
- `init-session.sh` ensures these files are always present and structured.

### 2. Manipulate Attention Through Recitation
**Manus Principle:** "By constantly rewriting the todo list, Manus is reciting its objectives into the end of the context... biasing its own focus toward the task objective."
**Implementation:**
- `PLAN.md` serves as the recitation mechanism.
- The `SKILL.md` workflow explicitly instructs the agent to "Read Context" (`PLAN.md`) before starting tasks and "Update Context" (`PLAN.md`) when tasks change.
- This ensures the current state and goals are always fresh in the agent's attention.

### 3. Keep the Wrong Stuff In (Error Persistence)
**Manus Principle:** "Erasing failure removes evidence... leave the wrong turns in the context. When the model sees a failed action... it implicitly updates its internal beliefs."
**Implementation:**
- `PROGRESS.md` is designed as an append-only log ("A chronological log of actions, decisions, and results").
- The templates have been updated to explicitly encourage logging "Failed Attempts" or "Anti-Patterns" in `KNOWLEDGE.md` and errors in `PROGRESS.md`.
- This prevents the agent from repeating mistakes by keeping a record of what *didn't* work.

### 4. Mask, Don't Remove (Tool Management)
**Manus Principle:** Constrain action space based on context (e.g., masking incompatible tools).
**Implementation:**
- While this skill doesn't implement low-level token masking (which requires model server access), the structured planning in `PLAN.md` acts as a high-level constraint.
- By defining specific "Tasks" and "Next Steps", the agent effectively narrows its own action space to relevant tools for the current phase.

## Academic Foundations for Coding Agents

This implementation is grounded in several key academic works that define the capabilities of autonomous agents:

### 1. Reasoning and Acting (ReAct)
**Reference:** *Yao et al. (2022), ReAct: Synergizing Reasoning and Acting in Language Models (arXiv:2210.03629)*.
**Mapping:**
- **Reasoning**: Represented by `PLAN.md`, where the agent breaks down complex tasks into manageable steps and hypotheses.
- **Acting**: Represented by `PROGRESS.md`, which logs the execution of tools and the observation of results.
- This explicit separation allows the agent to interleave thought and action effectively.

### 2. Skill Libraries (Voyager)
**Reference:** *Wang et al. (2023), Voyager: An Open-Ended Embodied Agent with Large Language Models*.
**Mapping:**
- **Skill Library**: Represented by `KNOWLEDGE.md`.
- Just as Voyager accumulates reusable code skills, `KNOWLEDGE.md` is designed to store "Reusable Code Patterns / API Usage" and "Anti-Patterns". This acts as a persistent library of "learned skills" that the agent can retrieve in future tasks or sessions.

### 3. Task Resolution & Verification (SWE-bench)
**Reference:** *Jimenez et al. (2023), SWE-bench: Can Language Models Resolve Real-World GitHub Issues?*
**Mapping:**
- **Verification**: The workflow emphasizes rigorous checking (`check-complete.sh`).
- The `CAPABILITY.md` defines "Quality Checks" (Test coverage, Linter compliance) inspired by the evaluation criteria used in benchmarks like SWE-bench to determine if a task is truly resolved.

### 4. Autonomous Digital Agents
**Reference:** *Shen & Yang (2025), From Mind to Machine: The Rise of Manus AI as a Fully Autonomous Digital Agent (arXiv:2505.02024)*.
**Mapping:**
- This skill embodies the "Mind to Machine" philosophy by providing the persistent memory structures required for full autonomy, allowing the agent to operate over extended periods without losing context or intent.
