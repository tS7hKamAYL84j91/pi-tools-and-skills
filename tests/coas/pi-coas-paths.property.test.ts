import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ConfinedStore } from "../../extensions/pi-coas/store.js";
import {
	assertSafeId,
	pathInside,
} from "../../extensions/pi-coas/store-paths.js";
import { assertAsyncProperty, assertProperty } from "../lib/fast-check.js";

const safeIdArbitrary = fc
	.array(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789_-"), {
		minLength: 1,
		maxLength: 24,
	})
	.map((characters) => `a${characters.join("")}`);

const unsafeIdArbitrary = fc.oneof(
	fc.constant(""),
	safeIdArbitrary.map((value) => `.${value}`),
	safeIdArbitrary.map((value) => `A${value}`),
	safeIdArbitrary.map((value) => `${value}/child`),
	safeIdArbitrary.map((value) => `${value}\\child`),
	fc.tuple(safeIdArbitrary, safeIdArbitrary).map(
		([first, second]) => `${first}..${second}`,
	),
);

const relativePathArbitrary = fc
	.array(safeIdArbitrary, { minLength: 1, maxLength: 5 })
	.map((segments) => join(...segments));

describe("bounded CoAS path properties", () => {
	it("accepts generated safe nested paths and rejects generated escapes", () => {
		const root = resolve("/fast-check/coas-root");
		assertProperty(
			fc.property(
				fc.array(safeIdArbitrary, { minLength: 1, maxLength: 5 }),
				safeIdArbitrary,
				(insideSegments, outsideSegment) => {
					const inside = join(root, ...insideSegments);
					const escaped = resolve(root, "..", `outside-${outsideSegment}`);

					expect(pathInside(root, inside)).toBe(true);
					expect(pathInside(root, escaped)).toBe(false);
				},
			),
		);
	});

	it("rejects generated unsafe identifiers", () => {
		assertProperty(
			fc.property(unsafeIdArbitrary, (unsafeId) => {
				expect(() => assertSafeId("property id", unsafeId)).toThrow(
					/Invalid property id/,
				);
			}),
		);
	});

	describe("ConfinedStore non-absolute targets", () => {
		let root: string;
		let store: ConfinedStore;

		beforeAll(async () => {
			root = await mkdtemp(join(tmpdir(), "pi-coas-fast-check-"));
			store = await ConfinedStore.forCoasHome({ coasHome: root });
		});

		afterAll(async () => {
			await rm(root, { recursive: true, force: true });
		});

		it("rejects every generated relative target without mutating it", async () => {
			await assertAsyncProperty(
				fc.asyncProperty(relativePathArbitrary, async (relativePath) => {
					expect(isAbsolute(relativePath)).toBe(false);
					await expect(store.fileExists(relativePath)).rejects.toThrow(
						/CoAS target must be absolute/,
					);
				}),
			);
		});
	});
});
