#!/usr/bin/env python3
"""Local Exercism ARM64 trials: dry-run by default; --execute makes model calls."""
import argparse
import hashlib
import importlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.dont_write_bytecode = True
sys.path.insert(0, str(ROOT))
from scripts.goal_benchmark_fixtures import (
    bounded_command, exercise_inputs, freeze_exercise, parse_unity, save_json, verify_solution,
)
from scripts import goal_benchmark_trial
from scripts.goal_benchmark_authored import prepare_authored_fixture, validate_controls, grade_authored_tests
from scripts.goal_benchmark_oracles import oracle_spec
bundle = importlib.import_module("scripts.goal_benchmark_bundle")


def git(directory, *args):
    return subprocess.check_output(["git", "-C", str(directory), *args], text=True, stderr=subprocess.DEVNULL).strip()


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--track-repo", type=Path, default=Path.home() / "exercism/arm64-assembly")
    parser.add_argument("--exercises", nargs="+")
    parser.add_argument("--test-mode", choices=["provided", "authored"], default="provided")
    parser.add_argument("--bundle", action="store_true", help="one prompt for ten stratified-random spec-only problems")
    parser.add_argument("--verified-completion", action="store_true", help="bundle-only: same trusted verifier feedback, max three checks per arm")
    parser.add_argument("--seed", type=int, default=20260919, help="reproducible bundle selection seed")
    parser.add_argument("--output", type=Path, help="new local result directory; never overwritten")
    parser.add_argument("--model", default="openai-codex/gpt-5.6-luna")
    parser.add_argument("--thinking", default="medium", choices=["off", "minimal", "low", "medium", "high", "xhigh", "max"])
    parser.add_argument("--repeats", type=int, default=1)
    parser.add_argument("--timeout", type=int, help="wall seconds per task/bundle (default 300/900), excluding startup")
    parser.add_argument("--max-calls", type=int, help="assistant response cap per task/bundle (default 80/240)")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--execute", action="store_true", help="explicitly opt in to local builds and live model calls")
    mode.add_argument("--prepare-only", action="store_true", help="create isolated fixtures without builds/model calls")
    mode.add_argument("--dry-run", action="store_true", help="preview only (default)")
    args = parser.parse_args()
    if args.bundle and (args.exercises is not None or args.test_mode != "provided"):
        parser.error("--bundle selects its own spec-only problems; do not combine with --exercises/--test-mode")
    if args.verified_completion and not args.bundle:
        parser.error("--verified-completion requires --bundle")
    args.timeout = args.timeout if args.timeout is not None else (900 if args.bundle else 300)
    args.max_calls = args.max_calls if args.max_calls is not None else (240 if args.bundle else 80)
    if args.exercises is None and not args.bundle:
        args.exercises = (["dominoes", "book-store", "rectangles"] if args.test_mode == "authored"
                          else ["collatz-conjecture", "leap", "reverse-string"])
    if not (1 <= args.repeats <= 20 and 10 <= args.timeout <= 3600 and 1 <= args.max_calls <= 500):
        parser.error("repeats: 1..20; timeout: 10..3600; max-calls: 1..500")
    if "/" not in args.model or args.model.startswith("ollama/"):
        parser.error("supply an explicit cloud provider/model (Ollama excluded for this experiment)")
    if args.exercises and len(set(args.exercises)) != len(args.exercises):
        parser.error("duplicate exercise names are not allowed")
    if (args.execute or args.prepare_only) and args.output is None:
        parser.error("--output is required for --execute or --prepare-only")
    return args


def prepare_case(track, slug, directory, repeats, test_mode="provided"):
    directory.mkdir()
    seed = directory / "seed"
    manifest = (prepare_authored_fixture(track, slug, seed, directory / "oracle") if test_mode == "authored"
                else freeze_exercise(track, slug, seed))
    git(seed, "init", "-q", "-b", "baseline")
    git(seed, "add", "--", ".")
    git(seed, "-c", "user.name=Local benchmark", "-c", "user.email=benchmark@localhost",
        "-c", "commit.gpgSign=false", "commit", "-qm", "test: freeze public exercise fixture")
    manifest["fixtureCommit"] = git(seed, "rev-parse", "HEAD")
    save_json(directory / "fixture.json", manifest)
    for repetition in range(1, repeats + 1):
        for arm in ["direct", "goal"]:
            name = f"{arm}-{repetition:02}"
            git(seed, "worktree", "add", "-q", "-b", name, str(directory / name))
    return manifest


def main():
    args = parse_args()
    track = args.track_repo.resolve()
    selection = bundle.select_ten(track, args.seed) if args.bundle else None
    if selection:
        args.exercises = [e["slug"] for e in selection]
        if any(slug not in bundle.ABI_NOTES for slug in args.exercises):
            raise ValueError("Selected bundle needs ABI review; do not reroll to hide unsupported cases")
    test_mode = "withheld-bundle" if args.bundle else args.test_mode
    preview = []
    for slug in args.exercises:
        if args.test_mode == "authored":
            oracle_spec(slug)  # Fail before any writes/model calls for unsupported contracts.
        _, solutions, tests, enabled = exercise_inputs(track, slug)
        preview.append({"exercise": slug, "solutions": solutions, "tests": tests, "skipsEnabled": enabled})
    if not args.execute and not args.prepare_only:
        print(json.dumps({"mode": "dry-run", "testMode": test_mode, "model": args.model, "thinking": args.thinking,
                          "selectionSeed": args.seed if args.bundle else None, "selection": selection,
                          "timeoutSeconds": args.timeout, "maxCalls": args.max_calls,
                          "trials": (2 if args.bundle else len(preview) * 2) * args.repeats, "cases": preview}, indent=2))
        return
    output = args.output.resolve()
    if output.exists() or output.is_relative_to(track) or track.is_relative_to(output):
        raise ValueError("Output must be a new directory outside the source repository")
    if args.execute:
        if platform.system() != "Linux" or platform.machine() not in ["aarch64", "arm64"]:
            raise ValueError("Live runs require native Linux ARM64; use --prepare-only elsewhere")
        if "PI_GOAL_GATE_COMMAND" in os.environ:
            raise ValueError("Run from a shell without PI_GOAL_GATE_COMMAND; this comparison uses the default ungated Goal")
        if any(shutil.which(command) is None for command in ["pi", "git", "make", "gcc", "as"]):
            raise ValueError("Required tools: pi, git, make, gcc, as")
    os.umask(0o077)
    output.mkdir(parents=True, exist_ok=False)
    report = {"schemaVersion": 1, "trackCommit": git(track, "rev-parse", "HEAD"),
              "trackDirty": bool(git(track, "status", "--porcelain")),
              "harnessCommit": git(ROOT, "rev-parse", "HEAD"),
              "harnessDirty": bool(git(ROOT, "status", "--porcelain")),
              "runnerHashes": {name: hashlib.sha256((ROOT / "scripts" / name).read_bytes()).hexdigest()
                               for name in ["goal-benchmark.py", "goal_benchmark_fixtures.py", "goal_benchmark_trial.py",
                                            "goal_benchmark_authored.py", "goal_benchmark_oracles.py", "goal_benchmark_bundle.py", "goal-benchmark-verify.py"]},
              "pythonVersion": platform.python_version(), "selection": selection,
              "selectionSeed": args.seed if args.bundle else None,
              "verifiedCompletion": args.verified_completion,
              "testMode": test_mode, "model": args.model, "thinking": args.thinking, "timeoutSeconds": args.timeout,
              "maxCalls": args.max_calls, "runs": []}
    save_json(output / "report.json", report)
    if args.bundle:
        bundle.run_bundle(args, output, report, selection, ROOT / "extensions/pi-goal/index.ts")
        print(f"{'Results' if args.execute else 'Prepared bundle'}: {output}")
        return
    for index, slug in enumerate(args.exercises):
        directory = output / slug
        manifest = prepare_case(track, slug, directory, args.repeats, args.test_mode)
        if not args.execute:
            continue
        oracle = directory / ("oracle" if args.test_mode == "authored" else "seed")
        if args.test_mode == "authored":
            controls = validate_controls(oracle, manifest, directory / "control-checks")
            save_json(directory / "control-checks.json", controls)
        baseline = bounded_command(["make"], oracle)
        save_json(directory / "baseline.json", {"exitCode": baseline["exitCode"], "timedOut": baseline["timedOut"],
                  "tests": parse_unity(baseline["text"], manifest["expectedTests"])})
        for repetition in range(1, args.repeats + 1):
            # Sequential arms avoid CPU contention; alternate order to expose ordering effects.
            arms = ["direct", "goal"] if (index + repetition) % 2 else ["goal", "direct"]
            for arm in arms:
                name = f"{arm}-{repetition:02}"
                workspace = directory / name
                evidence = directory / f"{name}-evidence"
                print(f"Running {slug}/{name} ({args.model})", flush=True)
                result = goal_benchmark_trial.run_trial(workspace, evidence, arm, args.model, args.thinking,
                                   ROOT / "extensions/pi-goal/index.ts", args.timeout, args.max_calls)
                result.update({"exercise": slug, "repetition": repetition})
                try:
                    result["verification"] = verify_solution(oracle, workspace, evidence / "judge", manifest)
                except (OSError, ValueError):
                    result["verification"] = {"passed": False, "error": "missing_or_unsafe_judge_input"}
                if args.test_mode == "authored":
                    try:
                        result["testQuality"] = grade_authored_tests(oracle, workspace, evidence / "test-quality", manifest)
                    except (OSError, ValueError):
                        result["testQuality"] = {"valid": False, "score": None, "error": "missing_or_unsafe_test_input"}
                result["success"] = (result["runtimeStatus"] == "settled" and result["verification"]["passed"]
                                     and not result["verification"].get("inputMismatches")
                                     and not result["verification"].get("unexpectedPaths")
                                     and result["testFirstObserved"]
                                     and result.get("testQuality", {}).get("valid", True)
                                     and (arm != "goal" or result["goalCompleted"]))
                save_json(evidence / "result.json", result)
                report["runs"].append(result)
                save_json(output / "report.json", report)
                print(f"  success={result['success']} test-first={result['testFirstObserved']} time={result['elapsedSeconds']}s", flush=True)
    print(f"{'Results' if args.execute else 'Prepared fixtures'}: {output}")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("Interrupted; existing evidence retained.", file=sys.stderr)
        sys.exit(130)
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        # Avoid dumping subprocess/provider output or environment on errors.
        print(f"Benchmark stopped: {type(error).__name__}. Check arguments, fixture paths and required tools.", file=sys.stderr)
        sys.exit(1)
