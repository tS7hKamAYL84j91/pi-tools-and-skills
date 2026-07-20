import { join } from "node:path";
import { mkdir, writeFile, readdir, readFile } from "node:fs/promises";
import { parseEnv } from "./extensions/pi-coas/store.js"; // just grabbing something to ensure parseEnv works, though we can skip this

// Copy of checkSchedules without the external dependencies for benchmarking
async function checkSchedulesSeq(root: string): Promise<number> {
	const entries = await readdir(root, { withFileTypes: true });
	let count = 0;
	let bad = 0;
	for (const entry of entries) {
		if (!entry.isFile() || !entry.name.endsWith(".env")) continue;
		count++;
		const envPath = join(root, entry.name);
		// Simulate what happens in loop
		const text = await readFile(envPath, "utf8");
		const taskId = entry.name.replace(/\.env$/, "");
		try {
			if (text.length < 5) throw new Error("missing required field");
		} catch (error) {
			bad++;
		}
	}
	return bad;
}

async function checkSchedulesPar(root: string): Promise<number> {
	const entries = await readdir(root, { withFileTypes: true });
	let bad = 0;

	const envEntries = entries.filter(e => e.isFile() && e.name.endsWith(".env"));

	await Promise.all(envEntries.map(async (entry) => {
		const envPath = join(root, entry.name);
		// Simulate what happens in loop
		const text = await readFile(envPath, "utf8");
		const taskId = entry.name.replace(/\.env$/, "");
		try {
			if (text.length < 5) throw new Error("missing required field");
		} catch (error) {
			bad++;
		}
	}));
	return bad;
}

async function run() {
    const root = join(process.cwd(), "test-coas-home-2");
    await mkdir(join(root, "schedules"), { recursive: true });

    // Create 1000 dummy schedules
    for (let i = 0; i < 1000; i++) {
        const content = `TASK_ID=task-${i}\nCRON_EXPR=* * * * *\nPROMPT_FILE=${join(root, `prompt-${i}.md`)}\nWORKSPACE_ID=ws-1\n`;
        await writeFile(join(root, "schedules", `sched-${i}.env`), content);
    }

    const schedulesRoot = join(root, "schedules");

    // warmup
    await checkSchedulesSeq(schedulesRoot);
    await checkSchedulesPar(schedulesRoot);

    const startSeq = performance.now();
    for (let i = 0; i < 10; i++) {
        await checkSchedulesSeq(schedulesRoot);
    }
    const endSeq = performance.now();

    const startPar = performance.now();
    for (let i = 0; i < 10; i++) {
        await checkSchedulesPar(schedulesRoot);
    }
    const endPar = performance.now();

    console.log(`Sequential: ${(endSeq - startSeq).toFixed(2)} ms`);
    console.log(`Parallel: ${(endPar - startPar).toFixed(2)} ms`);
}

run().catch(console.error);
