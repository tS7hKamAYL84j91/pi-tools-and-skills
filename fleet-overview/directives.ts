/** Dashboard directive storage; delivery only, never execution authority. */
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "../lib/file-persistence.js";
import { FLEET_HOME } from "./config.js";

export interface Directive {
	id: string;
	ts: string;
	from: string;
	re?: string;
	text: string;
}

async function readItems(dir: string): Promise<Directive[]> {
	let names: string[];
	try { names = await readdir(dir); } catch { return []; }
	const items: Directive[] = [];
	for (const name of names.filter(n => /\.(json|txt|md)$/.test(n))) {
		try {
			const raw = await readFile(join(dir, name), "utf8");
			const parsed: unknown = name.endsWith(".json") ? JSON.parse(raw) : undefined;
			if (parsed && typeof parsed === "object") {
				const data = parsed as Partial<Directive>;
				items.push({ id: String(data.id ?? name), ts: String(data.ts ?? ""), from: String(data.from ?? ""), re: data.re, text: String(data.text ?? "") });
			} else items.push({ id: name.replace(/\.[^.]+$/, ""), ts: "", from: "gravitas", text: raw });
		} catch { /* skip malformed runtime files */ }
	}
	return items.sort((a, b) => (b.ts || b.id).localeCompare(a.ts || a.id)).slice(0, 50);
}

export function createDirectiveStore(root = join(FLEET_HOME, "directives")) {
	return {
		async read() { return { inbox: await readItems(join(root, "inbox")), replies: await readItems(join(root, "replies")) }; },
		async send(value: unknown): Promise<Directive> {
			if (typeof value !== "string") throw new Error("text must be a string");
			const text = Array.from(value).filter(character => {
				const code = character.codePointAt(0) ?? 0;
				return !(code <= 8 || (code >= 11 && code <= 31) || code === 127);
			}).join("").trim().slice(0, 4000);
			if (!text) throw new Error("empty directive");
			const item = { id: `d-${Date.now()}-${randomUUID().slice(0, 8)}`, ts: new Date().toISOString().replace(".000Z", "Z"), from: "jim", text };
			await writeFileAtomic(join(root, "inbox", `${item.id}.json`), `${JSON.stringify(item, null, 2)}\n`);
			return item;
		},
	};
}
