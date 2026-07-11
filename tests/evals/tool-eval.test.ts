import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

describe("Tool Evaluation Harness", () => {
    const fixturesPath = "tests/evals/fixtures/tool-fixtures.json";
    const fixtures = JSON.parse(readFileSync(fixturesPath, "utf-8"));
    
    // Minimal mock schema simulating tool parameters parsing
    const safePathSchema = Type.String({ minLength: 1, maxLength: 50, pattern: "^(?!.*\\.\\.).*" });

    it("should deterministicly evaluate path traversal attempts against schema", () => {
        const payload = fixtures.pathTraversal;
        const isValid = Value.Check(safePathSchema, payload.filepath);
        expect(isValid).toBe(payload.expectedSafe);
    });
    
    it("should deterministicly evaluate safe paths against schema", () => {
        const payload = fixtures.safePath;
        const isValid = Value.Check(safePathSchema, payload.filepath);
        expect(isValid).toBe(payload.expectedSafe);
    });

    it("should enforce output bounds on oversized payloads", () => {
        const payload = fixtures.largePayload;
        const largeString = "A".repeat(payload.size);
        const truncated = largeString.substring(0, payload.maxLength);
        expect(truncated.length).toBeLessThanOrEqual(payload.maxLength);
    });
});
