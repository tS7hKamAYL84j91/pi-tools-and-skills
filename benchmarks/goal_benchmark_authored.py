"""Authored-test fixtures and independent test-quality grading for three hard cases."""
import hashlib
import importlib

from benchmarks.goal_benchmark_fixtures import bounded_command, freeze_exercise, parse_unity, regular_bytes
oracles = importlib.import_module("benchmarks.goal_benchmark_oracles")


def digest(content):
    return hashlib.sha256(content).hexdigest()


def prepare_authored_fixture(track, slug, seed, oracle):
    spec = oracles.oracle_spec(slug)
    official = freeze_exercise(track, slug, oracle)
    api = ("#ifndef BENCHMARK_API_H\n#define BENCHMARK_API_H\n" + spec["api"] + "#endif\n").encode()
    (oracle / "api.h").write_bytes(api)
    official["hashes"]["api.h"] = digest(api)
    seed.mkdir()
    visible = {}
    for name, expected in official["hashes"].items():
        if name.endswith("_test.c") or name == "TASK.md":
            continue
        content = regular_bytes(oracle / name)
        if digest(content) != expected:
            raise ValueError("Official fixture changed during preparation")
        target = seed / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
        visible[name] = expected
    task = (
        f"# ARM64 {slug}: author tests and implementation\n\n"
        "Read .docs/instructions.md, any .docs/introduction.md, and api.h. "
        f"ABI contract: {spec['contract']}\n\n"
        f"Implement {', '.join(official['solutions'])}. Write your own Unity C tests in agent_test.c; "
        "no official tests or reference implementations are provided. Include api.h and vendor/unity.h; "
        "define void setUp(void), void tearDown(void), and a main using UNITY_BEGIN(), "
        "RUN_TEST(test_name), and return UNITY_END(). The existing Makefile builds your tests.\n\n"
        "Use TDD: first write meaningful assertions derived from the spec, run `make` and observe "
        "a behavioral failure before editing assembly. Import/link/compiler failures and zero-test runs "
        "are not a red phase. Implement the minimum behavior, rerun `make`, and expand tests and code "
        "in red/green cycles. Cover boundaries and plausible incorrect algorithms, not just examples. "
        "Finish with `make clean && make`. Never remove or weaken an assertion to hide a defect. "
        "Your implementation will be checked against withheld official tests; your tests will also "
        "be checked against an independent correct control and predeclared faulty implementations.\n\n"
        "Only edit the assembly solution files, agent_test.c, and optionally TDD.md for a truthful "
        "cycle table. Do not edit api.h, vendor, Makefile, docs, configuration or Goal state. "
        "Build artifacts and automatic Goal runtime writes are allowed. No network, submissions, "
        "packages, commits, delegation or model changes. Do not read outside this worktree, other "
        "trials, official tests or reference implementations.\n\n"
        "Report checks and blockers honestly. If launched through /goal, complete that local goal "
        "with concrete evidence when done; otherwise finish normally. Do not create a goal yourself.\n")
    (seed / "TASK.md").write_text(task)
    visible["TASK.md"] = digest(task.encode())
    controls = {"reference": spec["reference"], **spec["faults"]}
    (oracle / "controls").mkdir()
    control_hashes = {}
    for name, content in controls.items():
        path = oracle / "controls" / f"{name}.c"
        path.write_text(content)
        control_hashes[name] = digest(content.encode())
    return {**official, "testMode": "authored", "testFiles": ["agent_test.c"],
            "hashes": visible, "oracleHashes": official["hashes"], "controlHashes": control_hashes}


def control_source(oracle, manifest, name):
    content = regular_bytes(oracle / "controls" / f"{name}.c")
    if digest(content) != manifest["controlHashes"][name]:
        raise ValueError("Frozen control source was modified")
    return {"control.c": content}


def judge_case(oracle, manifest, destination, implementation, workspace=None):
    destination.mkdir(parents=True)
    for name, expected in manifest["oracleHashes"].items():
        if name in manifest["solutions"] or name == "TASK.md" or name.startswith(".docs/"):
            continue
        if workspace is not None and name.endswith("_test.c"):
            continue
        content = regular_bytes(oracle / name)
        if digest(content) != expected:
            raise ValueError("Frozen judge input was modified")
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
    if workspace is not None:
        (destination / "agent_test.c").write_bytes(regular_bytes(workspace / "agent_test.c"))
    for name, content in implementation.items():
        (destination / name).write_bytes(content)
    build = bounded_command(["make", "tests"], destination)
    result = {"buildExitCode": build["exitCode"], "exitCode": None, "timedOut": build["timedOut"],
              "tests": parse_unity(""), "passed": False}
    if build["exitCode"] != 0 or build["timedOut"]:
        return result
    run = bounded_command(["./tests"], destination)
    tests = parse_unity(run["text"], manifest["expectedTests"] if workspace is None else None)
    return {**result, "exitCode": run["exitCode"], "timedOut": run["timedOut"], "tests": tests,
            "passed": run["exitCode"] == 0 and not run["timedOut"] and tests["passed"]}


def semantic_rejection(result, expected):
    tests = result["tests"]
    return (result["buildExitCode"] == 0 and not result["timedOut"]
            and result["exitCode"] is not None and result["exitCode"] > 0
            and tests["total"] == expected and tests["failed"] > 0 and tests["ignored"] == 0)


def validate_controls(oracle, manifest, destination):
    results = {}
    for name in manifest["controlHashes"]:
        results[name] = judge_case(oracle, manifest, destination / name, control_source(oracle, manifest, name))
    valid = results["reference"]["passed"] and all(
        semantic_rejection(result, manifest["expectedTests"])
        for name, result in results.items() if name != "reference")
    if not valid:
        raise ValueError("Correct/faulty judge controls failed official-suite preflight")
    return results


def grade_authored_tests(oracle, workspace, destination, manifest):
    implementation = {name: regular_bytes(workspace / name) for name in manifest["solutions"]}
    self_tests = judge_case(oracle, manifest, destination / "self", implementation, workspace)
    reference = judge_case(oracle, manifest, destination / "reference", control_source(oracle, manifest, "reference"), workspace)
    valid = self_tests["passed"] and reference["passed"]
    faults = [name for name in manifest["controlHashes"] if name != "reference"]
    results = []
    if valid:
        for name in faults:
            result = judge_case(oracle, manifest, destination / name, control_source(oracle, manifest, name), workspace)
            results.append({"fault": name, **result, "detected": semantic_rejection(result, reference["tests"]["total"])})
    detected = sum(result["detected"] for result in results)
    return {"valid": valid, "selfTests": self_tests, "reference": reference, "mutants": results,
            "detected": detected, "total": len(faults), "score": detected / len(faults) if valid else None}
