# Manus Coding Capability

## Skill Capability
**Name**: `planning-coding`
**Description**: Provides structured planning, execution, and verification for software engineering tasks using a persistent 3-file context system.

## Inputs
- **Task Description**: A clear statement of the coding goal (e.g., "Refactor the login module", "Implement feature X").
- **Codebase Path**: The root directory of the project.
- **Test Framework**: (Optional) The testing tool used (e.g., `pytest`, `jest`).

## Outputs
- **planning/PLAN.md**: A dynamic implementation plan tracking phases and task status.
- **planning/PROGRESS.md**: A chronological log of actions, test results, and decisions.
- **planning/KNOWLEDGE.md**: A repository of learned patterns, API usage, and anti-patterns.
- **Code Changes**: Modifications to the source code.

## Process
1.  **Initialize**: Run `skills/planning/scripts/init-session.sh` to set up the context files.
2.  **Plan (Reasoning)**:
    - Analyze the request and codebase.
    - Populate `PLAN.md` with a phased approach (e.g., Analysis, Implementation, Verification).
3.  **Act (Implementation)**:
    - Execute code changes.
    - Log actions and results in `PROGRESS.md`.
4.  **Verify (Testing)**:
    - Run tests.
    - Update `PLAN.md` task status based on results.
    - Use `skills/planning/scripts/check-complete.sh` to track overall progress.
5.  **Reflect (Knowledge)**:
    - Record successful patterns or "gotchas" in `KNOWLEDGE.md` to avoid repeating mistakes.

## Quality Checks
- **Plan Validity**: Does `PLAN.md` cover all requirements?
- **Traceability**: Can every change in the code be traced back to a task in `PLAN.md`?
- **Persistence**: Are errors logged in `PROGRESS.md` rather than ignored?
- **Completion**: Do all tasks in `PLAN.md` have a completed status `[x]`?
