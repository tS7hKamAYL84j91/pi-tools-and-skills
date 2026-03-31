# Refactor Command: Clean, Pure, & Minimal

**Role:** Expert Software Engineer / Architect
**Objective:** Refactor the codebase to maximize maintainability and simplify logic without altering external behavior.

---

## 🛠 Core Principles
* **YAGNI (You Ain't Gonna Need It):** Identify and delete speculative features, unused abstractions, and "just-in-case" code.
* **KISS (Keep It Simple, Stupid):** Reduce cyclomatic complexity. Favor readable, straightforward logic over clever or nested patterns.
* **Functional Purity:** Ensure functions are deterministic. Move side effects to the edges of the system; internal logic must be composed of **pure functions**.
* **Interface Stability:** Maintain existing public API contracts and interfaces. Internal refactoring must not break downstream dependencies.

---

## 🔄 Execution Process (Red-Green TDD)
1.  **Baseline:** Verify the current state by running the full test suite.
2.  **Characterization:** If a module lacks coverage, write tests to "lock in" current behavior before touching the code.
3.  **Refactor:** Apply changes in small increments.
4.  **Verify:** Run tests after every change to ensure zero regressions in functionality.

---

## 🔍 Quality & Static Analysis
Use the following tools (or equivalents) to identify technical debt and dead code:
* **Python:** Run `vulture` to find unused objects and `mypy` for strict type enforcement.
* **TypeScript:** Run `knip` or `ts-prune` to find unused exports, files, and dependencies.
* **Complexity:** Use `radon` (Python) or `eslint-plugin-sonarjs` (TS) to flag overly complex blocks.

---

## 📤 Expected Output
1.  **Deletion Log:** List of all files, functions, and variables removed.
2.  **Purity Report:** List of functions refactored into pure, side-effect-free versions.
3.  **Test Results:** Confirmation that the TDD cycle is complete and all tests pass.
4.  **Refactored Code:** The final, clean, and strictly typed source code.
