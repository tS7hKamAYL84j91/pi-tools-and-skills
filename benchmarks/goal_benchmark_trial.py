"""Bounded Pi RPC trials. Aggregate evidence only; Pi retains its own sessions."""
import json
import os
import re
import selectors
import subprocess
import tempfile
import time

from benchmarks.goal_benchmark_fixtures import parse_unity, terminate_group


class TrialEvidence:
    def __init__(self):
        self.data = {"invocations": 0, "assistantMessages": 0, "toolCalls": 0,
                     "providerRetries": 0, "goalCompleted": False, "usageMissing": 0,
                     "modelErrors": 0, "lastStopReason": None, "goalContinuationAttempts": [],
                     "tokens": dict.fromkeys(["input", "output", "cacheRead", "cacheWrite"], 0),
                     "estimatedCost": 0.0, "steps": []}
        self.calls = {}

    def observe(self, event):
        kind = event.get("type")
        if kind == "agent_start":
            self.data["invocations"] += 1
        if kind == "auto_retry_start":
            self.data["providerRetries"] += 1
        if kind == "message_end":
            message = event.get("message", {})
            if message.get("role") == "user":
                content = message.get("content", "")
                parts = content if isinstance(content, list) else []
                text = content if isinstance(content, str) else "\n".join(p.get("text", "") for p in parts if isinstance(p, dict))
                for match in re.findall(r"<!--\s*pi-goal-continuation:[^>]+:([0-9]{1,6})\s*-->", text):
                    try:
                        attempt = int(match)
                    except ValueError:
                        continue
                    if attempt >= 2 and attempt not in self.data["goalContinuationAttempts"]:
                        self.data["goalContinuationAttempts"].append(attempt)
            if message.get("role") == "assistant":
                self.data["assistantMessages"] += 1
                self.data["lastStopReason"] = message.get("stopReason")
                if message.get("stopReason") in ["error", "aborted"]:
                    self.data["modelErrors"] += 1
                if not message.get("usage"):
                    self.data["usageMissing"] += 1
            if message.get("role") in ["assistant", "toolResult"] and message.get("usage"):
                usage = message["usage"]
                for key in self.data["tokens"]:
                    self.data["tokens"][key] += usage.get(key, 0)
                self.data["estimatedCost"] += usage.get("cost", {}).get("total", 0)
        if kind == "tool_execution_start":
            self.data["toolCalls"] += 1
            name, args = event.get("toolName"), event.get("args", {})
            self.calls[event.get("toolCallId")] = (name, args)
            if name in ["edit", "write"]:
                path = str(args.get("path", ""))
                if path.endswith(".s"):
                    self.data["steps"].append({"kind": "solution-edit"})
                elif path.endswith("_test.c"):
                    self.data["steps"].append({"kind": "test-edit"})
        if kind == "tool_execution_end":
            if event.get("toolName") == "goal_complete" and not event.get("isError", True):
                self.data["goalCompleted"] = True
            name, args = self.calls.pop(event.get("toolCallId"), (None, {}))
            if name == "bash" and re.fullmatch(r"make(?:\s+clean\s*&&\s*make)?", args.get("command", "").strip()):
                text = "\n".join(c.get("text", "") for c in event.get("result", {}).get("content", []) if c.get("type") == "text")
                self.data["steps"].append({"kind": "test", **parse_unity(text), "toolError": event.get("isError", False)})

    def test_first(self):
        steps = self.data["steps"]
        edit = next((i for i, s in enumerate(steps) if s["kind"] == "solution-edit"), None)
        if edit is None:
            return False
        red = any(s["kind"] == "test" and s["failed"] > 0 for s in steps[:edit])
        green = any(s["kind"] == "test" and s["passed"] and not s["toolError"] for s in steps[edit + 1:])
        return red and green


def rpc_args(artifact_dir, model, thinking, goal_extension):
    return ["pi", "--mode", "rpc", "--model", model, "--thinking", thinking,
            "--session-dir", str(artifact_dir / "sessions"), "--no-approve",
            "--no-context-files", "--no-skills", "--no-prompt-templates",
            "--tools", "read,bash,edit,write,goal_get,goal_complete",
            "-e", str(goal_extension), "--append-system-prompt", str(artifact_dir / "system.md")]


def run_trial(workspace, artifact_dir, arm, model, thinking, goal_extension, timeout, max_calls, process_env=None):
    artifact_dir.mkdir()
    (artifact_dir / "system.md").write_text(
        "You are the root executor of this isolated local exercise trial. Read TASK.md and "
        "follow its scope. Do not access files outside this worktree, the source repository, "
        "reference solutions or other trials. No network, Exercism submissions, installation, "
        "delegation, commits or model changes. If launched under /goal, you own this local "
        "goal and may call goal_complete after validation. Otherwise do not use Goal tools.\n")
    evidence = TrialEvidence()
    result = {"arm": arm, "runtimeStatus": "preflight", "preflight": None}
    with tempfile.TemporaryFile() as stderr:
        env = {**os.environ, **(process_env or {})}
        child = subprocess.Popen(rpc_args(artifact_dir, model, thinking, goal_extension), cwd=workspace, env=env,
                                 stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=stderr, start_new_session=True)
        stdin, stdout = child.stdin, child.stdout
        assert stdin is not None and stdout is not None
        selector = selectors.DefaultSelector()
        selector.register(stdout, selectors.EVENT_READ)
        buffer = b""
        state = commands = None
        started = None
        deadline = time.monotonic() + 45

        def send(kind, **fields):
            stdin.write((json.dumps({"type": kind, **fields}) + "\n").encode())
            stdin.flush()

        try:
            send("get_state", id="state")
            send("get_commands", id="commands")
            while time.monotonic() < deadline:
                if not selector.select(timeout=0.25):
                    if child.poll() is not None:
                        result["runtimeStatus"] = "process_exited"
                        break
                    continue
                chunk = os.read(stdout.fileno(), 65_536)
                if not chunk:
                    result["runtimeStatus"] = "process_exited"
                    break
                buffer += chunk
                if len(buffer) > 8 * 1024 * 1024:
                    result["runtimeStatus"] = "rpc_frame_limit"
                    break
                stop = False
                while b"\n" in buffer:
                    line, buffer = buffer.split(b"\n", 1)
                    try:
                        event = json.loads(line)
                    except (ValueError, UnicodeDecodeError):
                        continue
                    evidence.observe(event)
                    if event.get("type") == "response":
                        if event.get("id") == "state":
                            state = event.get("data", {})
                        elif event.get("id") == "commands":
                            commands = [c["name"] for c in event.get("data", {}).get("commands", [])]
                        elif event.get("id") == "task":
                            if not event.get("success"):
                                result["runtimeStatus"] = "task_rejected"
                                stop = True
                            elif arm == "goal":
                                # Goal command returns only after its driver settles (not each low-level invocation).
                                result["runtimeStatus"] = "settled" if evidence.data["goalCompleted"] else "goal_stopped"
                                stop = True
                    if started is None and state is not None and commands is not None:
                        actual = state.get("model", {})
                        provider, _, model_id = model.partition("/")
                        result["preflight"] = {"model": actual.get("id"), "provider": actual.get("provider"),
                                               "thinking": state.get("thinkingLevel"), "goalAvailable": "goal" in commands}
                        if (actual.get("id") != model_id or actual.get("provider") != provider
                                or state.get("thinkingLevel") != thinking or "goal" not in commands
                                or state.get("messageCount") != 0):
                            result["runtimeStatus"] = "preflight_failed"
                            stop = True
                            break
                        started = time.monotonic()
                        result["startedAt"] = time.time()
                        deadline = started + timeout
                        result["runtimeStatus"] = "running"
                        prompt = "/goal file TASK.md" if arm == "goal" else "Read TASK.md and complete the task using its required test-first method."
                        send("prompt", id="task", message=prompt)
                    if started and arm == "direct" and event.get("type") == "agent_settled":
                        result["runtimeStatus"] = "agent_error" if evidence.data["lastStopReason"] in ["error", "aborted"] else "settled"
                        stop = True
                    if not stop and evidence.data["assistantMessages"] >= max_calls:
                        result["runtimeStatus"] = "call_limit"
                        stop = True
                    if stop:
                        break
                if stop:
                    break
            else:
                result["runtimeStatus"] = "timeout" if started else "preflight_timeout"
        finally:
            result["elapsedSeconds"] = round(time.monotonic() - started, 3) if started else None
            try:
                if started and arm == "goal" and not evidence.data["goalCompleted"]:
                    send("prompt", id="stop", message="/goal stop")
                send("abort", id="abort")
                # Give Pi a bounded chance to flush/contain before process-group cleanup.
                child.wait(timeout=0.5)
            except (BrokenPipeError, OSError, subprocess.TimeoutExpired):
                pass
            terminate_group(child)
            selector.close()
            stdin.close()
            stdout.close()
    result.update(evidence.data)
    result["testFirstObserved"] = evidence.test_first()
    result["tokens"]["total"] = sum(result["tokens"].values())
    return result
