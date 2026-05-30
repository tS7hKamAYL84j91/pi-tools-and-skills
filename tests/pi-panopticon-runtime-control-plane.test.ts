import { describe, expect, it } from "vitest";
import { RuntimeControlPlane } from "../lib/runtime-control-plane.js";

describe("RuntimeControlPlane", () => {
	it("registers, links, inspects, and emits runtime entities", () => {
		const runtime = new RuntimeControlPlane();
		const teamRun = runtime.registerEntity({
			id: "team-1",
			kind: "team_run",
			label: "navigator",
			status: "running",
		});
		const child = runtime.registerEntity({
			id: "child-1",
			kind: "child_process",
			label: "navigator model call",
			parent: teamRun,
		});

		expect(runtime.inspectEntity(teamRun)?.children).toEqual([child]);
		expect(runtime.inspectEntity(child)?.parent).toEqual(teamRun);
		expect(runtime.updateStatus(child, "completed")).toBe(true);
		expect(runtime.inspectEntity(child)?.status).toBe("completed");
		expect(runtime.listEvents().map((event) => event.type)).toContain("runtime.entity.linked");
	});

	it("stops entities through their registered stop adapter", () => {
		const reasons: string[] = [];
		const runtime = new RuntimeControlPlane();
		const run = runtime.registerEntity({
			id: "team-2",
			kind: "team_run",
			label: "deep-research",
			status: "running",
			stop: (reason) => reasons.push(reason),
		});

		expect(runtime.stopEntity(run, "user requested stop")).toBe(true);
		expect(reasons).toEqual(["user requested stop"]);
		expect(runtime.inspectEntity(run)?.status).toBe("stopping");
		expect(runtime.listEvents().at(-1)?.type).toBe("runtime.entity.stop_requested");
	});
});
