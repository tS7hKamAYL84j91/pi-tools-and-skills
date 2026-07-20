import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { coasStatus, coasDoctor } from "./extensions/pi-coas/status.js";

async function run() {
    const root = join(process.cwd(), "test-coas-home");
    await mkdir(join(root, "schedules"), { recursive: true });

    // Create 100 dummy schedules
    for (let i = 0; i < 100; i++) {
        const content = `TASK_ID=task-${i}\nCRON_EXPR=* * * * *\nPROMPT_FILE=${join(root, `prompt-${i}.md`)}\nWORKSPACE_ID=ws-1\n`;
        await writeFile(join(root, "schedules", `sched-${i}.env`), content);
        await writeFile(join(root, `prompt-${i}.md`), "prompt content");
    }

    const config = { coasHome: root };

    // warmup
    await coasDoctor(config);

    const start = performance.now();
    for (let i = 0; i < 10; i++) {
        await coasDoctor(config);
    }
    const end = performance.now();

    console.log(`Time taken: ${(end - start).toFixed(2)} ms`);
}

run().catch(console.error);
