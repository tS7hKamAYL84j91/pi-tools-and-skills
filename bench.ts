import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { checkTemplateSafety } from "./lib/template-safety.js";

mkdirSync("bench_tmp", { recursive: true });

const paths: string[] = [];
for (let i = 0; i < 500; i++) {
    // using an acceptable path for the safety checker
    const p = `tests/fixtures/template-safety/public-pack/bench_file_${i}.md`;
    writeFileSync(p, `Some content ${i}\npassword\nraw session\n`);
    paths.push(p);
}

async function run() {
    // Warmup
    await checkTemplateSafety(paths);

    const start = performance.now();
    await checkTemplateSafety(paths);
    const end = performance.now();
    console.log(`Baseline Time: ${end - start} ms`);

    for (const p of paths) {
        rmSync(p);
    }
    rmSync("bench_tmp", { recursive: true });
}

run().catch(console.error);
