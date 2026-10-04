"""Offline tests: no provider, Exercism API, or model calls."""
import importlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from benchmarks.goal_benchmark_fixtures import freeze_exercise, parse_unity, verify_inputs, verify_solution
from benchmarks.goal_benchmark_trial import TrialEvidence, rpc_args, run_trial
from benchmarks.goal_benchmark_authored import prepare_authored_fixture, semantic_rejection, grade_authored_tests
from benchmarks.goal_benchmark_oracles import oracle_spec
bundle = importlib.import_module("benchmarks.goal_benchmark_bundle")


class FixtureTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / "track/exercises/practice/leap"
        self.source.mkdir(parents=True)
        (self.source / ".docs").mkdir()
        (self.source / ".docs/instructions.md").write_text("Return whether a year is leap.\n")
        (self.source / ".meta").mkdir()
        (self.source / ".meta/example.s").write_text("SECRET REFERENCE SOLUTION")
        (self.source / "leap.s").write_text(".text\nleap_year: ret\n")
        (self.source / "leap_test.c").write_text(
            'void test_a(void) { TEST_IGNORE(); }\n'
            'int main(void) { RUN_TEST(test_a); return UNITY_END(); }\n')
        (self.source / "Makefile").write_text("all:\n\t@false\n")
        (self.source / "vendor").mkdir()
        for name in ["unity.c", "unity.h", "unity_internals.h"]:
            (self.source / "vendor" / name).write_text("/* fixture */\n")

    def test_freezes_only_public_inputs_and_enables_tests(self):
        original = (self.source / "leap_test.c").read_bytes()
        manifest = freeze_exercise(self.root / "track", "leap", self.root / "seed")
        self.assertEqual(manifest["expectedTests"], 1)
        self.assertEqual(manifest["solutions"], ["leap.s"])
        self.assertNotIn("TEST_IGNORE", (self.root / "seed/leap_test.c").read_text())
        self.assertFalse((self.root / "seed/.meta").exists())
        self.assertEqual((self.source / "leap_test.c").read_bytes(), original)
        self.assertEqual(verify_inputs(self.root / "seed", manifest), [])
        (self.root / "seed/Makefile").write_text("all:\n\t@true\n")
        self.assertIn("Makefile", verify_inputs(self.root / "seed", manifest))

    def test_rejects_traversal_and_symlink_inputs(self):
        for slug in ["../leap", "/tmp/leap", "leap/../../"]:
            with self.assertRaises(ValueError):
                freeze_exercise(self.root / "track", slug, self.root / "bad")
        (self.source / "leap.s").unlink()
        (self.source / "leap.s").symlink_to(self.source / ".meta/example.s")
        with self.assertRaises(ValueError):
            freeze_exercise(self.root / "track", "leap", self.root / "bad-link")

    def test_no_zero_test_or_skipped_test_success(self):
        for output in ["", "0 Tests 0 Failures 0 Ignored", "3 Tests 0 Failures 2 Ignored"]:
            self.assertFalse(parse_unity(output, 3)["passed"])
        self.assertTrue(parse_unity("3 Tests 0 Failures 0 Ignored\nOK", 3)["passed"])
        self.assertFalse(parse_unity("1 Tests 0 Failures 0 Ignored", 3)["passed"])
        self.assertFalse(parse_unity("3 Tests 1 Failures 0 Ignored", 3)["passed"])

    def test_judge_uses_frozen_tests_even_if_agent_changes_them(self):
        seed, workspace = self.root / "seed", self.root / "workspace"
        manifest = freeze_exercise(self.root / "track", "leap", seed)
        freeze_exercise(self.root / "track", "leap", workspace)
        (workspace / "leap_test.c").write_text("fake passing test")
        (workspace / "leap.s").write_text("candidate implementation")
        result = {"text": "1 Tests 0 Failures 0 Ignored", "exitCode": 0, "timedOut": False}
        with patch("benchmarks.goal_benchmark_fixtures.bounded_command", return_value=result), patch("benchmarks.goal_benchmark_fixtures.subprocess.check_output", return_value=b""):
            judged = verify_solution(seed, workspace, self.root / "judge", manifest)
        self.assertEqual((self.root / "judge/leap_test.c").read_bytes(), (seed / "leap_test.c").read_bytes())
        self.assertEqual((self.root / "judge/leap.s").read_text(), "candidate implementation")
        self.assertIn("leap_test.c", judged["inputMismatches"])

    def test_authored_fixture_withholds_cases_before_git_snapshot(self):
        source = self.source.with_name("dominoes")
        self.source.rename(source)
        (source / "leap.s").rename(source / "dominoes.s")
        (source / "leap_test.c").rename(source / "dominoes_test.c")
        with (source / "dominoes_test.c").open("a") as test:
            test.write("/* HIDDEN_CASE_SENTINEL */\n")
        seed, oracle = self.root / "seed", self.root / "oracle"
        manifest = prepare_authored_fixture(self.root / "track", "dominoes", seed, oracle)
        self.assertFalse((seed / "dominoes_test.c").exists())
        self.assertFalse((seed / "agent_test.c").exists())
        self.assertFalse((seed / "controls").exists())
        visible = b"".join(p.read_bytes() for p in seed.rglob("*") if p.is_file())
        self.assertNotIn(b"HIDDEN_CASE_SENTINEL", visible)
        self.assertIn("HIDDEN_CASE_SENTINEL", (oracle / "dominoes_test.c").read_text())
        self.assertIn("can_chain", (seed / "api.h").read_text())
        self.assertEqual(manifest["testFiles"], ["agent_test.c"])
        self.assertEqual(len(manifest["controlHashes"]), 4)
        self.assertEqual(verify_inputs(seed, manifest), [])
        (seed / "api.h").write_text("tampered contract")
        self.assertIn("api.h", verify_inputs(seed, manifest))

    def test_bundle_hides_cases_from_worktrees_and_git_history(self):
        (self.source / "leap_test.c").write_text(
            'extern int leap_year(int year);\nvoid setUp(void) {}\n'
            'void test_a(void) { /* HIDDEN_CASE_SENTINEL */ }\n'
            'int main(void) { RUN_TEST(test_a); return UNITY_END(); }\n')
        selection = [{"slug": slug, "difficulty": 2} for slug in bundle.ABI_NOTES]
        for entry in selection:
            if entry["slug"] != "leap":
                shutil.copytree(self.source, self.source.with_name(entry["slug"]))
        output = self.root / "bundle"
        output.mkdir()
        manifest = bundle.prepare_bundle(self.root / "track", output, selection, 1, True, self.root / "trusted verifier.py")
        self.assertEqual(len(manifest["problems"]), 10)
        tracked = subprocess.check_output(["git", "-C", str(output / "bundle-seed"), "ls-tree", "-r", "--name-only", "HEAD"], text=True)
        self.assertNotIn("_test.c", tracked)
        self.assertFalse(list((output / "direct-01").rglob("*_test.c")))
        self.assertFalse(list((output / "goal-01").rglob("*_test.c")))
        self.assertIn("HIDDEN_CASE_SENTINEL", (output / "oracles/leap/leap_test.c").read_text())
        self.assertNotIn("HIDDEN_CASE_SENTINEL", (output / "direct-01/leap/api.h").read_text())
        self.assertEqual((output / "direct-01/TASK.md").read_bytes(), (output / "goal-01/TASK.md").read_bytes())
        self.assertEqual((output / "direct-01/verify-bundle").read_bytes(), (output / "goal-01/verify-bundle").read_bytes())
        self.assertIn(f"'{self.root / 'trusted verifier.py'}'", (output / "direct-01/verify-bundle").read_text())
        self.assertTrue(manifest["verifiedCompletion"])
        hook = json.loads((output / "goal-01/.pi/goal/settings.json").read_text())
        self.assertEqual(hook["command"], "./verify-bundle")
        self.assertEqual(hook["timeoutMs"], 600000)
        self.assertEqual(hook["schemaVersion"], 1)

    def test_subdirectory_judging_does_not_flag_sibling_solutions(self):
        seed = self.root / "bundle"
        a, b = seed / "a", seed / "b"
        manifest = freeze_exercise(self.root / "track", "leap", a)
        freeze_exercise(self.root / "track", "leap", b)
        subprocess.run(["git", "-C", str(seed), "init", "-q"], check=True)
        subprocess.run(["git", "-C", str(seed), "add", "."], check=True)
        subprocess.run(["git", "-C", str(seed), "-c", "user.name=Test", "-c", "user.email=test@localhost", "-c", "commit.gpgSign=false", "commit", "-qm", "fixture"], check=True)
        (a / "leap.s").write_text("changed a")
        (b / "leap.s").write_text("changed b")
        command = {"text": "1 Tests 0 Failures 0 Ignored", "exitCode": 0, "timedOut": False}
        with patch("benchmarks.goal_benchmark_fixtures.bounded_command", return_value=command):
            result = verify_solution(a, a, self.root / "judge", manifest)
        self.assertEqual(result["unexpectedPaths"], [])

    def test_dry_run_never_launches_pi_or_creates_output(self):
        out = self.root / "not-created"
        result = subprocess.run([sys.executable, str(ROOT / "benchmarks/goal-benchmark.py"),
                                 "--track-repo", str(self.root / "track"), "--exercises", "leap",
                                 "--output", str(out)], capture_output=True, text=True, check=True)
        self.assertIn("dry-run", result.stdout)
        self.assertFalse(out.exists())

    def test_prepare_only_finds_moved_runner_hashes_without_model_calls(self):
        out = self.root / "prepared"
        # The CLI records the source revision even for preparation-only runs.
        track = self.root / "track"
        subprocess.run(["git", "-C", str(track), "init", "-q"], check=True)
        subprocess.run(["git", "-C", str(track), "add", "."], check=True)
        subprocess.run(["git", "-C", str(track), "-c", "user.name=Test",
                        "-c", "user.email=test@localhost", "-c", "commit.gpgSign=false",
                        "commit", "-qm", "fixture"], check=True)
        subprocess.run([sys.executable, "-B", str(ROOT / "benchmarks/goal-benchmark.py"),
                        "--prepare-only", "--track-repo", str(track),
                        "--exercises", "leap", "--output", str(out)],
                       cwd=self.root, capture_output=True, text=True, check=True)
        report = json.loads((out / "report.json").read_text())
        self.assertEqual(len(report["runnerHashes"]), 7)
        self.assertTrue(all(len(digest) == 64 for digest in report["runnerHashes"].values()))
        self.assertEqual(report["runs"], [])

    def test_verified_bundle_resolves_verifier_next_to_moved_runner(self):
        args = SimpleNamespace(track_repo=self.root, repeats=1, verified_completion=True, execute=False)
        with patch.object(bundle, "prepare_bundle", return_value={}) as prepare:
            bundle.run_bundle(args, self.root, {}, [], ROOT / "extensions/pi-goal/index.ts")
        self.assertEqual(prepare.call_args.args[-1], ROOT / "benchmarks/goal-benchmark-verify.py")
        result = subprocess.run([sys.executable, "-B", str(prepare.call_args.args[-1]), "--help"],
                                cwd=self.root, capture_output=True, text=True, check=True)
        self.assertIn("--workspace", result.stdout)


class RpcTests(unittest.TestCase):
    def test_both_arms_use_identical_explicit_model_and_extensions(self):
        args = rpc_args(Path("/trial"), "openai-codex/gpt-5.6-luna", "medium", Path("/goal.ts"))
        self.assertEqual(args[args.index("--model") + 1], "openai-codex/gpt-5.6-luna")
        self.assertEqual(args[args.index("-e") + 1], "/goal.ts")
        self.assertIn("--no-approve", args)
        self.assertNotIn("--no-session", args)

    def test_usage_accumulates_across_goal_invocations_not_stream_deltas(self):
        evidence = TrialEvidence()
        message = {"role": "assistant", "usage": {"input": 10, "output": 2,
                   "cacheRead": 30, "cacheWrite": 0, "cost": {"total": 0.1}}}
        for _ in range(2):
            evidence.observe({"type": "agent_start"})
            evidence.observe({"type": "message_update", "usage": message["usage"]})
            evidence.observe({"type": "message_end", "message": message})
        self.assertEqual(evidence.data["invocations"], 2)
        self.assertEqual(evidence.data["assistantMessages"], 2)
        self.assertEqual(evidence.data["tokens"]["input"], 20)
        self.assertEqual(evidence.data["tokens"]["cacheRead"], 60)
        self.assertAlmostEqual(evidence.data["estimatedCost"], 0.2)

    def test_continuation_markers_are_distinct_from_retries_and_assistant_claims(self):
        evidence = TrialEvidence()
        marker = "<!-- pi-goal-continuation:g-test:2 -->"
        for _ in range(2):
            evidence.observe({"type": "message_end", "message": {"role": "user", "content": marker}})
        evidence.observe({"type": "message_end", "message": {"role": "assistant", "content": marker.replace(":2", ":3")}})
        evidence.observe({"type": "auto_retry_start"})
        self.assertEqual(evidence.data["goalContinuationAttempts"], [2])
        self.assertEqual(evidence.data["providerRetries"], 1)

    def test_only_successful_completion_tool_counts(self):
        evidence = TrialEvidence()
        evidence.observe({"type": "tool_execution_end", "toolName": "goal_complete", "isError": True})
        self.assertFalse(evidence.data["goalCompleted"])
        evidence.observe({"type": "tool_execution_end", "toolName": "goal_complete", "isError": False})
        self.assertTrue(evidence.data["goalCompleted"])

    def test_test_first_evidence_is_observed_not_claimed(self):
        evidence = TrialEvidence()
        evidence.observe({"type": "tool_execution_start", "toolName": "bash", "toolCallId": "r", "args": {"command": "make"}})
        evidence.observe({"type": "tool_execution_end", "toolName": "bash", "toolCallId": "r", "isError": True,
                          "result": {"content": [{"type": "text", "text": "3 Tests 1 Failures 0 Ignored"}]}})
        evidence.observe({"type": "tool_execution_start", "toolName": "edit", "args": {"path": "leap.s"}})
        evidence.observe({"type": "tool_execution_start", "toolName": "bash", "toolCallId": "g", "args": {"command": "make"}})
        evidence.observe({"type": "tool_execution_end", "toolName": "bash", "toolCallId": "g", "isError": False,
                          "result": {"content": [{"type": "text", "text": "3 Tests 0 Failures 0 Ignored"}]}})
        self.assertTrue(evidence.test_first())
        self.assertNotIn("content", json.dumps(evidence.data))

    def test_setup_failure_and_echo_do_not_establish_test_first(self):
        for command, text in [("make", "assembler error"), ("echo fake", "3 Tests 1 Failures 0 Ignored")]:
            evidence = TrialEvidence()
            evidence.observe({"type": "tool_execution_start", "toolName": "bash", "toolCallId": "r", "args": {"command": command}})
            evidence.observe({"type": "tool_execution_end", "toolName": "bash", "toolCallId": "r", "isError": True,
                              "result": {"content": [{"type": "text", "text": text}]}})
            evidence.observe({"type": "tool_execution_start", "toolName": "edit", "args": {"path": "leap.s"}})
            self.assertFalse(evidence.test_first())


class BundleSelectionTests(unittest.TestCase):
    def test_stratified_selection_is_reproducible_and_unique(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            entries = [{"slug": f"problem-{difficulty}-{i}", "difficulty": difficulty}
                       for difficulty in range(1, 10) for i in range(5)]
            (root / "config.json").write_text(json.dumps({"exercises": {"practice": entries}}))
            first = bundle.select_ten(root, 20260919)
            self.assertEqual(first, bundle.select_ten(root, 20260919))
            self.assertEqual(len({e['slug'] for e in first}), 10)
            self.assertEqual([e['difficulty'] for e in first], sorted(e['difficulty'] for e in first))
            for low, high, count in [(1, 2, 2), (3, 4, 2), (5, 6, 3), (7, 8, 2), (9, 9, 1)]:
                self.assertEqual(sum(low <= e['difficulty'] <= high for e in first), count)

    def test_api_extraction_excludes_cases_and_rejects_global_expected_data(self):
        header = bundle.extract_api('extern int f(int value);\nvoid setUp(void) {}\n/* HIDDEN_CASE */')
        self.assertIn(b'extern int f', header)
        self.assertNotIn(b'HIDDEN_CASE', header)
        with self.assertRaises(ValueError):
            bundle.extract_api('static const int expected[] = {42};\nextern int f(void);\nvoid setUp(void) {}')


class TestQualityTests(unittest.TestCase):
    def test_faults_are_predeclared_and_distinct(self):
        for slug in ["dominoes", "book-store", "rectangles"]:
            spec = oracle_spec(slug)
            self.assertEqual(len(spec["faults"]), 3)
            self.assertTrue(all(code != spec["reference"] for code in spec["faults"].values()))
        with self.assertRaises(ValueError):
            oracle_spec("unsupported")

    def test_only_semantic_assertion_failure_gets_fault_credit(self):
        result = {"buildExitCode": 0, "exitCode": 1, "timedOut": False,
                  "tests": parse_unity("3 Tests 1 Failures 0 Ignored")}
        self.assertTrue(semantic_rejection(result, 3))
        for patch_values in [{"buildExitCode": 2}, {"exitCode": -11}, {"timedOut": True},
                             {"tests": parse_unity("3 Tests 0 Failures 0 Ignored")},
                             {"tests": parse_unity("3 Tests 1 Failures 1 Ignored")}]:
            self.assertFalse(semantic_rejection({**result, **patch_values}, 3))

    def test_always_failing_tests_cannot_earn_a_fault_score(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "solution.s").write_text("ret\n")
            manifest = {"solutions": ["solution.s"], "controlHashes": {"reference": "unused", "fault": "unused"}}
            with patch("benchmarks.goal_benchmark_authored.control_source", return_value={"control.c": b"code"}), patch(
                "benchmarks.goal_benchmark_authored.judge_case", side_effect=[{"passed": True}, {"passed": False}]
            ) as judge:
                result = grade_authored_tests(root, root, root / "grade", manifest)
            self.assertFalse(result["valid"])
            self.assertIsNone(result["score"])
            self.assertEqual(result["mutants"], [])
            self.assertEqual(judge.call_count, 2)


class FakeRpcIntegrationTests(unittest.TestCase):
    def run_fake(self, arm, mode="complete", limit=10):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            binary = root / "pi"
            binary.write_text('''#!/usr/bin/env python3
import json, os, sys

def emit(event):
    print(json.dumps(event), flush=True)

for line in sys.stdin:
    request = json.loads(line)
    kind = request['type']
    if kind == 'get_state':
        data = {'model': {'id':'model','provider':'test'}, 'thinkingLevel':'medium','messageCount':0}
    elif kind == 'get_commands':
        data = {'commands':[{'name':'goal'}]}
    elif kind == 'prompt' and request.get('id') == 'task':
        mode = os.environ['FAKE_MODE']
        if mode == 'wait':
            continue
        emit({'type':'agent_start'})
        emit({'type':'message_end', 'message':{'role':'assistant','stopReason':'error' if mode == 'error' else 'stop','usage':{'input':10,'output':2}}})
        if mode == 'complete' and request['message'].startswith('/goal'):
            emit({'type':'tool_execution_end','toolName':'goal_complete','isError':False})
        emit({'type':'agent_settled'})
        data = {}
    else:
        data = {}
    emit({'type':'response','command':kind,'id':request.get('id'),'success':True,'data':data})
''')
            binary.chmod(0o755)
            env = {"PATH": f"{root}{os.pathsep}{os.environ['PATH']}"}
            with patch.dict(os.environ, env):
                result = run_trial(root, root / "evidence", arm, "test/model", "medium", root / "goal.ts", 0.2, limit,
                                   {"FAKE_MODE": mode, "PI_GOAL_GATE_COMMAND": "trusted-check"})
            self.assertEqual(result["preflight"]["model"], "model")
            return result

    def test_direct_and_actual_goal_command_routes(self):
        direct, goal = self.run_fake("direct"), self.run_fake("goal")
        self.assertEqual(direct["runtimeStatus"], "settled")
        self.assertFalse(direct["goalCompleted"])
        self.assertEqual(goal["runtimeStatus"], "settled")
        self.assertTrue(goal["goalCompleted"])
        self.assertEqual(goal["tokens"]["total"], 12)

    def test_provider_failure_is_not_task_completion(self):
        result = self.run_fake("direct", "error")
        self.assertEqual(result["runtimeStatus"], "agent_error")
        self.assertEqual(result["modelErrors"], 1)

    def test_goal_stop_is_not_reported_as_completion(self):
        result = self.run_fake("goal", "stop")
        self.assertEqual(result["runtimeStatus"], "goal_stopped")
        self.assertFalse(result["goalCompleted"])

    def test_wall_and_model_call_budgets_stop_trials(self):
        self.assertEqual(self.run_fake("goal", "wait")["runtimeStatus"], "timeout")
        self.assertEqual(self.run_fake("goal", limit=1)["runtimeStatus"], "call_limit")


if __name__ == "__main__":
    unittest.main()
