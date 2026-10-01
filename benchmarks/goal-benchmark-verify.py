#!/usr/bin/env python3
"""Trusted, bounded bundle verifier used by paired local benchmark arms."""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.dont_write_bytecode = True
sys.path.insert(0, str(ROOT))
from benchmarks.goal_benchmark_fixtures import regular_bytes, verify_solution


def main():
 parser = argparse.ArgumentParser()
 parser.add_argument("--bundle", type=Path, required=True)
 parser.add_argument("--workspace", type=Path, required=True)
 args = parser.parse_args()
 bundle, workspace = args.bundle.resolve(), args.workspace.resolve()
 if workspace.parent != bundle or not re.fullmatch(r"(?:direct|goal)-\d{2}", workspace.name):
  raise ValueError("Unexpected benchmark workspace")
 try:
  manifest = json.loads(regular_bytes(bundle / "bundle.json"))
 except (OSError, json.JSONDecodeError) as error:
  raise ValueError("Invalid benchmark manifest") from error
 state_root = workspace / ".pi"
 if state_root.is_symlink(): raise ValueError("Unsafe verifier state root")
 state_root.mkdir(parents=True, exist_ok=True)
 judge_base = state_root / "bundle-verifier"
 if judge_base.is_symlink(): raise ValueError("Unsafe verifier judge root")
 judge_base.mkdir(exist_ok=True)
 if not judge_base.resolve().is_relative_to(workspace): raise ValueError("Verifier judge escaped workspace")
 attempt_file = state_root / "bundle-verifier-attempts"
 if attempt_file.is_symlink(): raise ValueError("Unsafe verifier attempt state")
 try:
  attempt = int(attempt_file.read_text()) + 1 if attempt_file.exists() else 1
  attempt_file.write_text(str(attempt))
 except (OSError, ValueError) as error:
  raise ValueError("Invalid verifier attempt state") from error
 if os.environ.get("PI_GOAL_BENCHMARK_ARM") == "direct" and attempt > 3:
  print("Verifier budget exhausted (3/3).")
  return 2
 judge_root = judge_base / f"attempt-{attempt}"
 if judge_root.exists():
  try: shutil.rmtree(judge_root)
  except OSError as error: raise ValueError("Cannot reset verifier workspace") from error
 judge_root.mkdir(parents=True)
 failures = []
 for slug, case in manifest["problems"].items():
  try:
   result = verify_solution(bundle / "oracles" / slug, workspace / slug, judge_root / slug, case)
  except (OSError, ValueError):
   print(f"{slug}: verifier execution error")
   return 2
  tests = result.get("tests", {})
  passed = result.get("passed") and not result.get("inputMismatches") and not result.get("unexpectedPaths")
  print(f"{slug}: {'PASS' if passed else 'FAIL'} ({tests.get('total', 0)} tests, {tests.get('failed', 0)} failures)")
  if not passed: failures.append(slug)
 print(f"Bundle verifier: {10 - len(failures)}/10 passed; attempt {attempt}/3.")
 return 1 if failures else 0


if __name__ == "__main__":
 try: raise SystemExit(main())
 except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError):
  print("Bundle verifier execution error.", file=sys.stderr)
  raise SystemExit(2)
