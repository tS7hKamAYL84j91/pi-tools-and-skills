"""One-prompt, ten-problem continuation pilot with withheld official tests."""
import hashlib
import json
import random
import re
import shlex
import subprocess

from scripts.goal_benchmark_fixtures import freeze_exercise, regular_bytes, save_json, verify_solution
from scripts.goal_benchmark_trial import run_trial

# Interface semantics reviewed against the selected track revision, not test cases.
ABI_NOTES = {
    "collatz-conjecture": "steps returns the number of Collatz steps, or INVALID_NUMBER (-1) for nonpositive input.",
    "leap": "leap_year returns nonzero for a Gregorian leap year and zero otherwise.",
    "grains": "square returns zero for square numbers outside 1..64. total returns the unsigned 64-bit board total.",
    "queen-attack": "Rows and columns are zero-based 0..7. Both functions return 1 or 0. can_attack receives distinct, valid queen positions.",
    "luhn": "valid receives a NUL-terminated string and returns nonzero iff it satisfies the Luhn specification.",
    "protein-translation": "Write NUL-terminated output into the caller's sufficiently large buffer. Each protein name is followed by a newline, including the last. Empty input produces an empty string. Unknown/incomplete codons before a STOP invalidate the whole translation (empty output); ignore everything after STOP.",
    "spiral-matrix": "Write the square matrix row-major into dest (caller supplies size*size capacity). Return the count written, size*size; size zero writes nothing and returns zero.",
    "book-store": "Return the optimal basket price in integer cents. Book IDs are 1..5; empty input costs zero and may have a NULL basket pointer.",
    "meetup": "Write the selected date as a NUL-terminated YYYY-MM-DD string, without a newline, into the caller's buffer. Month is 1..12; week/day enum values are declared in api.h.",
    "dominoes": "Return nonzero iff all stones can form a closed chain, zero otherwise. The empty set is valid. Values are uint16_t. Do not modify input stones; you need not output the chain.",
}


def select_ten(track, seed):
    try:
        entries = json.loads(regular_bytes(track / "config.json"))["exercises"]["practice"]
        if not isinstance(entries, list) or any(
            not isinstance(e, dict) or not isinstance(e.get("slug"), str)
            or not isinstance(e.get("difficulty"), int) for e in entries
        ):
            raise ValueError("Invalid practice exercise metadata")
    except (OSError, ValueError, KeyError, TypeError) as error:
        raise ValueError("Cannot read practice exercises from track config.json") from error
    rng = random.Random(seed)
    chosen = []
    for low, high, count in [(1, 2, 2), (3, 4, 2), (5, 6, 3), (7, 8, 2), (9, 9, 1)]:
        pool = sorted((e for e in entries if low <= e["difficulty"] <= high), key=lambda e: e["slug"])
        if len(pool) < count:
            raise ValueError("Insufficient exercises in a requested difficulty stratum")
        chosen.extend(rng.sample(pool, count))
    return [{"slug": e["slug"], "difficulty": e["difficulty"]}
            for e in sorted(chosen, key=lambda e: (e["difficulty"], e["slug"]))]


def extract_api(test_source):
    prefix, separator, _ = test_source.partition("void setUp")
    if not separator:
        raise ValueError("ABI requires manual review: missing setup boundary")
    prefix = re.sub(r"//[^\n]*|/\*.*?\*/", "", prefix, flags=re.DOTALL)
    declaration = r"(?:\s+|#(?:include|define)[^\n]*(?:\n|$)|extern[^;]+;|typedef\s+(?:struct|enum)\s*\{[^}]*\}\s*\w+\s*;)*"
    if not re.fullmatch(declaration, prefix, flags=re.DOTALL) or "extern " not in prefix:
        raise ValueError("ABI prefix includes unreviewed data or executable code")
    prefix = prefix.replace('#include "vendor/unity.h"', "")
    return ("#ifndef EXERCISE_API_H\n#define EXERCISE_API_H\n" + prefix + "\n#endif\n").encode()


def git(cwd, *args):
    return subprocess.check_output(["git", "-C", str(cwd), *args], text=True, stderr=subprocess.DEVNULL).strip()


def prepare_bundle(track, output, selection, repeats, verified=False, verifier_script=None):
    seed = output / "bundle-seed"
    seed.mkdir()
    manifests = {}
    (output / "oracles").mkdir()
    for entry in selection:
        slug = entry["slug"]
        if slug not in ABI_NOTES:
            raise ValueError(f"ABI notes need review for {slug}; do not reroll the sample")
        oracle = output / "oracles" / slug
        official = freeze_exercise(track, slug, oracle)
        tests = [name for name in official["hashes"] if name.endswith("_test.c")]
        if len(tests) != 1:
            raise ValueError("Bundle ABI extraction requires one official C test file")
        api = extract_api(regular_bytes(oracle / tests[0]).decode())
        workspace = seed / slug
        workspace.mkdir()
        visible = {}
        for name, expected in official["hashes"].items():
            if name.endswith("_test.c") or name == "TASK.md":
                continue
            content = regular_bytes(oracle / name)
            target = workspace / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
            visible[name] = expected
        (workspace / "api.h").write_bytes(api)
        visible["api.h"] = hashlib.sha256(api).hexdigest()
        contract = f"# {slug}\n\nRead .docs/instructions.md and any introduction.\n\n{ABI_NOTES[slug]}\n"
        (workspace / "CONTRACT.md").write_text(contract)
        visible["CONTRACT.md"] = hashlib.sha256(contract.encode()).hexdigest()
        manifests[slug] = {**official, "hashes": visible, "oracleHashes": official["hashes"], "testFiles": ["agent_test.c"]}
    listing = "\n".join(f"{i}. {e['slug']} (difficulty {e['difficulty']})" for i, e in enumerate(selection, 1))
    task = (
        "# Complete this entire ten-problem ARM64 bundle\n\n" + listing + "\n\n"
        "This is ONE task covering ALL listed problems, easiest to hardest. Each directory "
        "contains its public spec, CONTRACT.md, api.h, assembly stub and build/test tooling, "
        "but no supplied test cases. Read each contract; implement all required functions. "
        "You may write your own Unity tests in each directory's agent_test.c. Define setUp, "
        "tearDown and main with UNITY_BEGIN/RUN_TEST/UNITY_END when using Unity. "
        "Run builds/tests from the individual directory; give shell test commands bounded "
        "timeouts so a buggy implementation cannot consume the whole bundle budget.\n\n"
        "Continue across problems without asking for another prompt. Do not deliberately "
        "stop after each problem. Keep a concise PROGRESS.md at the root if useful for "
        "resumption. Do not claim the bundle complete while any problem is unfinished. "
        "Use meaningful checks and report real blockers honestly. The controller will "
        "grade every solution against withheld official tests only after your run ends.\n\n"
        "Only edit the supplied .s solution files, per-problem agent_test.c/TDD.md, and "
        "root PROGRESS.md. Keep contracts, specs, headers, Makefiles and vendor code "
        "unchanged. Build artifacts and automatic Goal runtime writes are allowed. "
        "Do not read outside this worktree, other arms, oracle cases or reference solutions. "
        "No network, submissions, installations, delegation, commits or model changes. "
        "If launched under /goal, you own this one local bundle goal; complete it only "
        "after auditing all ten requirements. Otherwise finish normally. Never create "
        "or manually edit Goal state.\n")
    if verified:
        task += ("\n## Trusted completion feedback\n\nWhen all ten look complete, request the bounded trusted verifier. "
         "If an active /goal owns this bundle, call goal_complete; it runs the verifier, so do not run ./verify-bundle directly. "
         "Otherwise run ./verify-bundle. A normal exit 1 gives concise failure counts: repair only those failures and retry, up to three total checks. "
         "Exit 2 is a verifier/budget error: stop honestly. Do not inspect the wrapper or verifier implementation.\n")
        if verifier_script is None: raise ValueError("Verified bundle requires a verifier script")
        wrapper = f"#!/bin/sh\nexec python3 {shlex.quote(str(verifier_script))} --bundle {shlex.quote(str(output))} --workspace \"$PWD\"\n"
        (seed / "verify-bundle").write_text(wrapper)
        (seed / "verify-bundle").chmod(0o700)
    (seed / "TASK.md").write_text(task)
    (seed / ".gitignore").write_text("*.o\ntests\n/.pi/\n")
    root_files = ["TASK.md", ".gitignore", *( ["verify-bundle"] if verified else [])]
    root_hashes = {name: hashlib.sha256((seed / name).read_bytes()).hexdigest() for name in root_files}
    git(seed, "init", "-q", "-b", "baseline")
    git(seed, "add", "--", ".")
    git(seed, "-c", "user.name=Local benchmark", "-c", "user.email=benchmark@localhost",
        "-c", "commit.gpgSign=false", "commit", "-qm", "test: freeze spec-only exercise bundle")
    for repetition in range(1, repeats + 1):
        for arm in ["direct", "goal"]:
            name = f"{arm}-{repetition:02}"
            git(seed, "worktree", "add", "-q", "-b", name, str(output / name))
    manifest = {"fixtureCommit": git(seed, "rev-parse", "HEAD"), "selection": selection, "verifiedCompletion": verified,
                "problems": manifests, "rootHashes": root_hashes}
    save_json(output / "bundle.json", manifest)
    return manifest


def run_bundle(args, output, report, selection, goal_extension):
    manifest = prepare_bundle(args.track_repo.resolve(), output, selection, args.repeats, args.verified_completion,
                              goal_extension.parents[2] / "scripts/goal-benchmark-verify.py" if args.verified_completion else None)
    if not args.execute:
        return
    for repetition in range(1, args.repeats + 1):
        arms = ["direct", "goal"] if repetition % 2 else ["goal", "direct"]
        for arm in arms:
            name = f"{arm}-{repetition:02}"
            workspace, evidence = output / name, output / f"{name}-evidence"
            print(f"Running ten-problem bundle/{name}", flush=True)
            process_env = ({"PI_GOAL_GATE_COMMAND": "./verify-bundle", "PI_GOAL_REPAIR_ATTEMPTS": "2",
                            "PI_GOAL_GATE_TIMEOUT_MS": "600000", "PI_GOAL_BENCHMARK_ARM": arm}
                           if args.verified_completion else None)
            result = run_trial(workspace, evidence, arm, args.model, args.thinking, goal_extension,
                               args.timeout, args.max_calls, process_env)
            problems = []
            allowed = {"PROGRESS.md"}
            for slug, case in manifest["problems"].items():
                allowed.update(f"{slug}/{p}" for p in case["solutions"] + ["agent_test.c", "TDD.md"])
                try:
                    verified = verify_solution(output / "oracles" / slug, workspace / slug, evidence / f"judge-{slug}", case)
                except (OSError, ValueError):
                    verified = {"passed": False, "error": "missing_or_unsafe_judge_input"}
                problems.append({"exercise": slug, **verified})
            root_mismatches = []
            for path, expected in manifest["rootHashes"].items():
                try:
                    matches = hashlib.sha256(regular_bytes(workspace / path)).hexdigest() == expected
                except (OSError, ValueError):
                    matches = False
                if not matches:
                    root_mismatches.append(path)
            head_changed = git(workspace, "rev-parse", "HEAD") != manifest["fixtureCommit"]
            changed = git(workspace, "diff", "--name-only", "HEAD").splitlines()
            added = git(workspace, "ls-files", "--others", "--exclude-standard").splitlines()
            unexpected = sorted(set(changed + added) - allowed)
            passed = sum(p["passed"] and not p.get("inputMismatches") and not p.get("unexpectedPaths") for p in problems)
            result.update({"repetition": repetition, "problems": problems, "passedProblems": passed,
                           "totalProblems": len(problems), "rootMismatches": root_mismatches, "unexpectedPaths": unexpected,
                           "headChanged": head_changed, "success": result["runtimeStatus"] == "settled" and passed == len(problems)
                           and not root_mismatches and not unexpected and not head_changed and (arm != "goal" or result["goalCompleted"])})
            save_json(evidence / "result.json", result)
            report["runs"].append(result)
            save_json(output / "report.json", report)
            print(f"  {arm}: {passed}/{len(problems)} verified; invocations={result['invocations']}; {result['runtimeStatus']}", flush=True)
