"""Benchmark-only frozen ARM64 inputs and independent local verification."""
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import tempfile

SLUG = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*\Z")
UNITY = re.compile(r"(\d+) Tests (\d+) Failures (\d+) Ignored")


def save_json(path, data):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(data, indent=2) + "\n")
    temporary.replace(path)


def regular_bytes(path):
    if path.is_symlink() or not path.is_file():
        raise ValueError(f"Expected regular, non-symlink input: {path.name}")
    if any(parent.is_symlink() for parent in path.parents):
        raise ValueError("Symlink input directory is not allowed")
    if path.stat().st_size > 2_000_000:
        raise ValueError(f"Oversized fixture input: {path.name}")
    return path.read_bytes()


def exercise_inputs(track, slug):
    if not SLUG.fullmatch(slug):
        raise ValueError("Exercise must be a simple slug")
    source = track / "exercises/practice" / slug
    solutions = sorted(p.name for p in source.glob("*.s") if p.name != "example.s")
    tests = sorted(p.name for p in source.glob("*_test.c"))
    if not solutions or not tests:
        raise ValueError(f"Missing assembly starter or C tests for {slug}")
    names = solutions + tests + ["Makefile", "vendor/unity.c", "vendor/unity.h", "vendor/unity_internals.h"]
    for name in [".docs/introduction.md", ".docs/instructions.md"]:
        if (source / name).exists():
            names.append(name)
    if ".docs/instructions.md" not in names:
        raise ValueError(f"Missing public instructions for {slug}")
    # Deliberate allowlist: never copy .meta, examples, exercise metadata or configs.
    files = {name: regular_bytes(source / name) for name in names}
    enabled = 0
    for name in tests:
        text = files[name].decode()
        text, count = re.subn(r"\bTEST_IGNORE\s*\(\s*\)\s*;", "/* Enabled by benchmark before freezing. */", text)
        if re.search(r"\bTEST_IGNORE", text):
            raise ValueError(f"Unsupported ignore macro in {slug}; enable explicitly before benchmarking")
        enabled += count
        files[name] = text.encode()
    expected = sum(len(re.findall(rb"\bRUN_TEST\s*\(", files[name])) for name in tests)
    if expected < 1:
        raise ValueError(f"No official tests found for {slug}")
    return files, solutions, expected, enabled


def freeze_exercise(track, slug, destination):
    files, solutions, expected, enabled = exercise_inputs(track, slug)
    destination.mkdir(parents=True, exist_ok=False)
    for name, content in files.items():
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
    (destination / ".gitignore").write_text("*.o\n/tests\n/.pi/\n")
    (destination / "TASK.md").write_text(
        f"# ARM64 {slug}\n\nRead .docs/instructions.md and any .docs/introduction.md. "
        f"Implement the exercise in {', '.join(solutions)}. All {expected} official tests are already enabled.\n\n"
        "Use test-first execution: run `make` before editing, inspect the behavioral failure, "
        "then implement a small change and rerun `make`. Repeat as needed. Setup/compiler errors "
        "are not behavioral red results. Finish with `make clean && make`. Never weaken tests. "
        "The tests are supplied: this measures test-first use, not test authorship.\n\n"
        "Only edit the listed assembly solution files and optionally TDD.md for a short, truthful "
        "command/result table. Do not modify supplied tests, vendor, Makefile, instructions or "
        "configuration. Build artifacts and automatic Goal runtime writes are allowed. "
        "No network, packages, submissions, commits, delegation, or model changes. "
        "Do not read outside this worktree, other trials, or reference solutions.\n\n"
        "Report checks and unresolved blockers honestly. If this task was launched through /goal, "
        "complete that local goal with concrete evidence when done; otherwise finish normally. "
        "Do not create or manually edit Goal state.\n")
    files["TASK.md"] = (destination / "TASK.md").read_bytes()
    files[".gitignore"] = (destination / ".gitignore").read_bytes()
    return {"exercise": slug, "solutions": solutions, "expectedTests": expected,
            "enabledTests": enabled, "hashes": {name: hashlib.sha256(data).hexdigest() for name, data in files.items()}}


def verify_inputs(workspace, manifest):
    mismatches = []
    for name, expected in manifest["hashes"].items():
        if name in manifest["solutions"]:
            continue
        try:
            actual = hashlib.sha256(regular_bytes(workspace / name)).hexdigest()
        except (OSError, ValueError):
            actual = None
        if actual != expected:
            mismatches.append(name)
    return mismatches


def parse_unity(text, expected=None):
    matches = UNITY.findall(text)
    if not matches:
        return {"passed": False, "total": 0, "failed": 0, "ignored": 0}
    total, failed, ignored = map(int, matches[-1])
    return {"passed": total > 0 and failed == 0 and ignored == 0 and (expected is None or total == expected),
            "total": total, "failed": failed, "ignored": ignored}


def terminate_group(child):
    for sig in [signal.SIGTERM, signal.SIGKILL]:
        try:
            os.killpg(child.pid, sig)
        except ProcessLookupError:
            return
        try:
            child.wait(timeout=2)
        except subprocess.TimeoutExpired:
            continue
    child.wait()


def bounded_command(argv, cwd, timeout=30):
    # Logs are not returned wholesale to reports; callers extract bounded evidence.
    with tempfile.TemporaryFile() as output:
        child = subprocess.Popen(argv, cwd=cwd, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
        timed_out = False
        try:
            child.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            timed_out = True
        finally:
            terminate_group(child)
        output.seek(0)
        text = output.read(65_536).decode(errors="replace")
    return {"exitCode": child.returncode, "timedOut": timed_out, "text": text}


def verify_solution(seed, workspace, destination, manifest):
    """Build in a fresh judge directory: never trust agent binaries or Makefile edits."""
    destination.mkdir()
    judge_hashes = manifest.get("oracleHashes", manifest["hashes"])
    for name in judge_hashes:
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        origin = workspace if name in manifest["solutions"] else seed
        content = regular_bytes(origin / name)
        if name not in manifest["solutions"] and hashlib.sha256(content).hexdigest() != judge_hashes[name]:
            raise ValueError("Frozen judge input was modified")
        target.write_bytes(content)
    result = bounded_command(["make"], destination)
    tests = parse_unity(result["text"], manifest["expectedTests"])
    changed = subprocess.check_output(["git", "-C", str(workspace), "diff", "--relative", "--name-only", "HEAD", "-z", "--", "."])
    added = subprocess.check_output(["git", "-C", str(workspace), "ls-files", "--others", "--exclude-standard", "-z", "--", "."])
    allowed = set(manifest["solutions"]) | set(manifest.get("testFiles", [])) | {"TDD.md"}
    unexpected = sorted({p for p in (changed + added).decode().split("\0") if p and p not in allowed})
    return {"passed": result["exitCode"] == 0 and not result["timedOut"] and tests["passed"],
            "exitCode": result["exitCode"], "timedOut": result["timedOut"], "tests": tests,
            "inputMismatches": verify_inputs(workspace, manifest), "unexpectedPaths": unexpected}
