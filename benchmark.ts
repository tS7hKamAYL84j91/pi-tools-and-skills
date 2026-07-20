import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { readdir, stat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

const root = "/tmp/coas_logs_bench";
if (!existsSync(root)) {
    mkdirSync(root, { recursive: true });
}

// Create 1000 dummy logs
for (let i = 0; i < 1000; i++) {
    writeFileSync(join(root, `log_${i}.log`), "some line\nFAILED\nSKIP busy\nOK\n", "utf8");
}

async function runBaseline() {
    const start = performance.now();
    const entries = await readdir(root, { withFileTypes: true });
    const failures: string[] = [];
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".log")) continue;
        const path = join(root, entry.name);
        const info = await stat(path);
        if (info.mtimeMs < weekAgo) continue;
        const text = await readFile(path, "utf8");
        for (const line of text.split("\n")) {
            if (/FAILED|SKIP busy/.test(line)) failures.push(`${entry.name}: ${line}`);
        }
    }
    const end = performance.now();
    return { time: end - start, failuresCount: failures.length };
}

async function runOptimized() {
    const start = performance.now();
    const entries = await readdir(root, { withFileTypes: true });
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    const promises = entries.map(async (entry) => {
        if (!entry.isFile() || !entry.name.endsWith(".log")) return [];
        const path = join(root, entry.name);
        const info = await stat(path);
        if (info.mtimeMs < weekAgo) return [];
        const text = await readFile(path, "utf8");
        const fileFailures: string[] = [];
        for (const line of text.split("\n")) {
            if (/FAILED|SKIP busy/.test(line)) fileFailures.push(`${entry.name}: ${line}`);
        }
        return fileFailures;
    });

    const results = await Promise.all(promises);
    const failures = results.flat();

    const end = performance.now();
    return { time: end - start, failuresCount: failures.length };
}

async function run() {
    console.log("Warming up...");
    await runBaseline();
    await runOptimized();

    let baselineTime = 0;
    let optimizedTime = 0;
    const iterations = 10;

    for (let i = 0; i < iterations; i++) {
        baselineTime += (await runBaseline()).time;
    }
    for (let i = 0; i < iterations; i++) {
        optimizedTime += (await runOptimized()).time;
    }

    console.log(`Baseline Avg: ${baselineTime / iterations} ms`);
    console.log(`Optimized Avg: ${optimizedTime / iterations} ms`);
}

run().catch(console.error);
