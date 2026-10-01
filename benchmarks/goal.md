# Local direct-vs-Goal exercise benchmark

Part of the [benchmark area](README.md); commands below run from the repo root.

Runs paired Pi agents against the public Exercism ARM64 Assembly exercises.
No Exercism account is needed. The runner never invokes Exercism, submits a
solution, pushes Git commits, or changes live model/schedule configuration.

## Run

Requires Python 3.10+, Git, and a local clone of
<https://github.com/exercism/arm64-assembly>. Live runs additionally need Linux
ARM64, `make`, GCC, GNU assembler, Pi, and authentication for the chosen model.

```sh
# Preview only: no writes, builds, or model calls. This is the default.
npm run benchmark:goal

# Prepare fixtures/worktrees only; no model calls or compilation.
npm run benchmark:goal -- --prepare-only --output /tmp/goal-fixtures

# Run both approaches for the three starter problems.
npm run benchmark:goal -- --execute \
  --track-repo /home/jim/exercism/arm64-assembly \
  --exercises collatz-conjecture leap reverse-string \
  --output /home/jim/exercism/.loop-trials/arm64-batch-01

# Harder condition: agents author their own tests, official cases withheld.
npm run benchmark:goal -- --execute --test-mode authored \
  --output /home/jim/exercism/.loop-trials/arm64-authored-01

# Continuation pilot: one prompt per arm for ten spec-only problems.
npm run benchmark:goal -- --execute --bundle --seed 20260919 \
  --output /home/jim/exercism/.loop-trials/arm64-bundle-01

# Same bundle, equivalent withheld acceptance feedback, max three checks/arm.
npm run benchmark:goal -- --execute --bundle --verified-completion --seed 20260919 \
  --output /home/jim/exercism/.loop-trials/arm64-bundle-verified-01

# Repeat a selected problem with explicit per-run limits.
npm run benchmark:goal -- --execute --exercises leap --repeats 3 \
  --timeout 180 --max-calls 40 --output /tmp/goal-leap-repeats
```

Every output directory must be new and outside the source clone. Prepared runs
are not resumed by `--execute`: choose another output directory. Existing
sessions, results and worktrees are never removed automatically. Runs are
sequential, with direct/Goal ordering alternated between problems/repetitions.
Ctrl-C terminates the current child process group and retains existing evidence.

Default per-trial model: `openai-codex/gpt-5.6-luna`, reasoning `medium`.
`--model provider/id` and `--thinking` apply only to these processes. Ollama is
excluded for the current experiment. Defaults are five minutes and 80 assistant
responses per trial; each Pi startup has a separate 45-second timeout. Judge
builds have a 30-second timeout. Live provider calls require **`--execute`**.

## What is controlled

- Both arms start from the same fixture commit in separate Git worktrees.
- Only public starter `.s` files, `*_test.c`, the Makefile, Unity vendor files,
  and public instructions are copied. No `.meta`, reference implementations,
  personal `.exercism` metadata or solution downloads.
- `TEST_IGNORE()` is removed **before freezing**; unsupported ignore forms fail
  setup. The expected `RUN_TEST` count is recorded. Zero tests or ignored tests
  cannot pass verification.
- Same explicit model, reasoning, tool allowlist and system supplement. Global
  extensions remain installed; project config/skills/context discovery is not
  trusted or used. Goal is loaded explicitly and its command/model availability
  is checked before sending either task.
- Direct receives a normal task prompt. Goal receives `/goal file TASK.md`.
  The default experiment supplies no completion verifier: current Goal must
  pause rather than record unverified completion. Use
  `--bundle --verified-completion` for the paired acceptance-feedback condition. An
  inherited `PI_GOAL_GATE_COMMAND` is rejected rather than silently changed.
- No coaching, automatic cross-arm retries or work sharing. Source repo stays
  untouched. This is trusted-agent isolation, **not an OS/network sandbox**:
  agents are instructed not to read outside their worktree or use the network.

## Agent-authored tests

`--test-mode authored` defaults to Dominoes, Book Store and Rectangles; those
are currently the supported authored-test contracts. Agents receive the public
specification, assembly stubs, a protected `api.h`, Makefile and Unity tooling.
They must create `agent_test.c` and demonstrate red before modifying assembly.
Official cases are never included in their seed Git history or worktrees.
The original `provided` mode and its three easier defaults remain unchanged.

The controller freezes an out-of-worktree oracle containing all official cases,
a small independently written C control, and three named faulty variants per
problem. **Before model calls**, native preflight requires the control to pass
the full official suite and each fault to fail a real assertion. These controls
come from the public specification, not Exercism's `.meta` implementations.
Their hashes and preflight results are retained alongside the fixture.

After each run, the controller checks separately:

1. Agent assembly against the withheld official suite.
2. Agent-authored tests against the agent assembly and the correct C control.
3. Those same tests against each predeclared fault.

A fault earns credit only for a nonzero test exit with explicit failed assertions
and unchanged test count; compilation errors, crashes, skipped tests and timeouts
earn no credit. If the correct control or the agent's own tests do not pass,
`testQuality.score` is null, not a misleading fault-detection score. Investigate
such failures: they may indicate bad expectations, ABI issues or control resource
limits, rather than automatically proving the tests wrong. Book Store's control
uses exact memoized subset search, so extreme input sizes can exceed judge budgets.

`testQuality` records the distinct outcomes and detected/total faults. Overall
`success` additionally requires passing self-tests and the correct-control check;
it does **not** require a perfect mutation score. A result can have correct code
and valid but weak tests. Three seeded faults are a diagnostic sample, not a
comprehensive measure of test quality. Both arms keep identical time/call limits.

## Ten-problem continuation bundle

`--bundle` samples ten distinct exercises with a recorded seed: two at difficulty
1–2, two at 3–4, three at 5–6, two at 7–8, and one at 9. It sorts the result from
easy to hard. Seed `20260919` selects Collatz, Leap, Grains, Queen Attack, Luhn,
Protein Translation, Spiral Matrix, Book Store, Meetup, and Dominoes. Selection
is stratified, not a uniform draw from all 79 exercises. No rerolls are performed.
Interface notes are currently reviewed for this selection; other seeds can stop
for ABI review rather than silently resampling easier/supported problems.

Each arm receives **one prompt for the whole bundle**, with 900 seconds and 240
assistant responses total by default. Overrides also apply to the whole bundle,
not per problem. There are no follow-up nudges or instructions to stop between
problems. Both may write their own tests and a root PROGRESS.md. Goal alone may
continue naturally through its existing replacement-session mechanism.

Official cases are outside both worktrees and absent from their Git history.
Agents get public specs and ABI-only headers, plus reviewed interface notes
(e.g. integer cents, newline-separated proteins and date output format). Test
prefix extraction rejects executable/global data rather than copying it into
headers. Each problem builds independently; there is no root Makefile.

After an arm stops, all ten implementations are independently judged against
frozen official tests. The report includes per-problem results, passedProblems,
whole-bundle success, runtime status and aggregate cost/usage. Optional authored
tests are not mutation-scored in this mode, and the global testFirstObserved
flag is not a bundle success criterion. Multiple low-level invocations alone
are not proof of Goal continuation: `goalContinuationAttempts` records distinct
host user-message continuation markers separately from provider retries.
A larger workload may still finish in one invocation; do not manufacture an
advantage by forcing the direct arm to stop early.

`--verified-completion` adds the same withheld official-suite summary to both
arms, bounded to three checks. Direct invokes the protected `./verify-bundle`
wrapper; Goal receives the same command through `goal_complete` with two
opt-in repairs. The wrapper reports only per-problem test/failure counts, not
cases. This is a deliberate surface asymmetry (shell command versus Goal tool),
recorded in the report; the independent final judge remains separate. Verifier
execution errors/timeouts stop rather than consuming repair permission.

## Evidence and interpretation

`report.json` contains source/harness revisions and dirty flags, runner hashes,
actual model preflight, runtime status, independent verification, observed
red-before-edit/green-after-edit evidence, time, invocation/model/tool counts,
provider retries and usage. Usage accumulates from finalized messages across
Goal replacement sessions, not streaming deltas or only the final session.
Cache-read tokens are separate; costs are runtime estimates, not verified bills.

Each case retains a frozen seed, per-arm worktrees, baseline result, and private
per-arm evidence directories. Pi's original sessions are retained there; the
report does not copy raw transcripts, provider errors, credentials or prompts.
Output is owner-private by default. Do not commit these session directories.

After each trial the controller creates a fresh judge directory from frozen
inputs plus **only the agent's permitted solution files**. It compiles and runs
those official tests, checks their counts, checks test/build input hashes, and
reports unexpected tracked/untracked file changes. Agent-built executables and
edited tests are never used as the independent verifier.

`success` requires a settled run, passing independent tests, unchanged protected
inputs, no unexpected files, observed test-first evidence, and (for Goal) a
successful `goal_complete`. `testFirstObserved` recognizes canonical `make` /
`make clean && make` calls and `.s` edits through write/edit tools. Shell-based
edits or noncanonical test commands need manual review; absence of this evidence
is not proof the agent skipped test-first work. In `provided` mode this measures use of prewritten
tests; `authored` mode also records test-file edits and independently grades the
agent-written suite.

A passing test suite does not prove complete correctness. Exercism exercises
are public and may be in model training data. One easy task or one paired run
cannot establish a general benefit from Goal. Continuation/recovery are only
exercised when the recorded invocation count exceeds one or a failure occurs.

## Offline checks

```sh
python3 -B tests/evals/goal_benchmark_test.py
npx vitest run tests/evals/goal-benchmark.test.ts
```

These use synthetic fixtures and a fake RPC child, not live providers. They cover
fixture isolation, enabled/frozen tests, judge integrity, usage accounting,
completion semantics, test-first observations, timeouts and model-call limits.
Hyphenated scripts (`goal-benchmark.py`, `goal-benchmark-verify.py`) are
command-line entries; underscored `goal_benchmark_*.py` modules are importable
libraries for the runner and tests.
