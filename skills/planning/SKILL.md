---
name: planning
description: Implements Manus-style persistent markdown planning using PLAN.md, PROGRESS.md, and KNOWLEDGE.md. Use this skill to maintain long-term context and structured planning.
license: MIT
metadata:
  display_name: Manus Planning
  version: "1.0.0"
  author: Jules
---

# Manus Planning

This skill enables agents to maintain long-term context and structured planning using a set of persistent markdown files.

## Workflow

1.  **Initialize**:
    Run `skills/planning/scripts/init-session.sh` to initialize the `planning/` directory and create the following files if they don't exist:
    *   `planning/PLAN.md`: Stores the high-level plan, goals, and task status.
    *   `planning/PROGRESS.md`: A chronological log of actions, decisions, and results.
    *   `planning/KNOWLEDGE.md`: A repository of learned information, constraints, and architectural decisions.

2.  **Read Context**:
    Before starting any task, read `planning/PLAN.md` to understand the current objectives and `planning/PROGRESS.md` to see what has been done recently.

3.  **Update Context**:
    *   Update `planning/PLAN.md` when tasks are completed, modified, or added.
    *   Append to `planning/PROGRESS.md` after every significant action or step. Use a timestamped format.
    *   Update `planning/KNOWLEDGE.md` when you discover new information that is useful for future tasks.

4.  **Verify Progress**:
    Run `skills/planning/scripts/check-complete.sh` to see the current completion status of tasks in `planning/PLAN.md`.

## File Usage

### planning/PLAN.md
Maintain a clear list of goals and tasks. Mark tasks as completed `[x]` as you finish them.

### planning/PROGRESS.md
Log your actions chronologically. This helps you and other agents understand the history of the project.

### planning/KNOWLEDGE.md
Store key decisions, findings, and reusable snippets here. This serves as a long-term memory.

## Resources

*   `assets/PLAN_TEMPLATE.md`: Template for the plan file.
*   `assets/PROGRESS_TEMPLATE.md`: Template for the progress log.
*   `assets/KNOWLEDGE_TEMPLATE.md`: Template for the knowledge base.
