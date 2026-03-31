import { describe, it, expect } from 'vitest';

// ── Copy of functions to test in isolation ──────────────────────────────

/** Current (buggy) version — strips milliseconds */
function nowZ_buggy(): string {
	return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Fixed version — returns full ISO 8601 with ms */
function nowZ_fixed(): string {
	return new Date().toISOString();
}

/** Current version of parseKV (may have edge case bugs) */
function parseKV(fields: string[]): Record<string, string> {
	const kv: Record<string, string> = {};
	let i = 0;
	while (i < fields.length) {
		const field = fields[i] ?? "";
		const eq = field.indexOf("=");
		if (eq <= 0) { i++; continue; }
		const key = field.slice(0, eq);
		let val = field.slice(eq + 1);
		if (val.startsWith('"')) {
			val = val.slice(1);
			while (!val.endsWith('"') && i + 1 < fields.length) {
				i++;
				val += ` ${fields[i] ?? ""}`;
			}
			if (val.endsWith('"')) val = val.slice(0, -1);
		}
		kv[key] = val;
		i++;
	}
	return kv;
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('nowZ()', () => {
	it('should return full ISO 8601 with milliseconds', () => {
		const result = nowZ_fixed();
		// Pattern: YYYY-MM-DDTHH:MM:SS.sssZ
		expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
		// Verify milliseconds are present (should have 3 digits before Z)
		const parts = result.split('.');
		expect(parts).toHaveLength(2);
		expect(parts[1]).toMatch(/^\d{3}Z$/);
	});

	it('should NOT strip milliseconds like buggy version does', () => {
		const buggy = nowZ_buggy();
		const fixed = nowZ_fixed();
		
		// Buggy version should end with Z without milliseconds
		expect(buggy).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
		
		// Fixed version should have milliseconds
		expect(fixed).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
		
		// They should be different (unless timing is exact, which won't happen in test)
		// Actually they might be the same length due to timing, but the pattern differs
		// Better check: fixed should be 4 chars longer (3 digits + dot)
		expect(fixed.length).toBe(buggy.length + 4);
	});
});

describe('parseKV()', () => {
	it('should parse simple key=value pairs', () => {
		const result = parseKV(['priority=high', 'agent=worker']);
		expect(result).toEqual({
			priority: 'high',
			agent: 'worker',
		});
	});

	it('should parse quoted values with spaces', () => {
		const result = parseKV(['title="Hello World"', 'priority=high']);
		expect(result).toEqual({
			title: 'Hello World',
			priority: 'high',
		});
	});

	it('should handle quoted values spanning multiple fields', () => {
		const result = parseKV(['title="Hello', 'World"', 'priority=high']);
		expect(result).toEqual({
			title: 'Hello World',
			priority: 'high',
		});
	});

	it('should handle a quoted value containing an equals sign', () => {
		// Bug: quoted value contains '=' which should NOT be treated as a key=value delimiter
		const result = parseKV(['title="foo=bar"', 'priority=high']);
		expect(result).toEqual({
			title: 'foo=bar',
			priority: 'high',
		});
	});

	it('should handle a quoted value with continuation word containing equals', () => {
		// More complex: a continuation word itself looks like key=value
		const result = parseKV(['title="foo', 'bar=baz"', 'priority=high']);
		expect(result).toEqual({
			title: 'foo bar=baz',
			priority: 'high',
		});
	});

	it('should handle multiple equals signs in a quoted value', () => {
		const result = parseKV(['query="a=b&c=d"', 'type=url']);
		expect(result).toEqual({
			query: 'a=b&c=d',
			type: 'url',
		});
	});

	it('should ignore fields without equals signs', () => {
		const result = parseKV(['title="test"', 'invalid_field', 'priority=high']);
		expect(result).toEqual({
			title: 'test',
			priority: 'high',
		});
	});

	it('should handle empty quoted strings', () => {
		const result = parseKV(['title=""', 'priority=high']);
		expect(result).toEqual({
			title: '',
			priority: 'high',
		});
	});

	it('should handle quoted value at the end of list', () => {
		const result = parseKV(['priority=high', 'title="Final Value"']);
		expect(result).toEqual({
			priority: 'high',
			title: 'Final Value',
		});
	});

	it('should handle real-world kanban log entry', () => {
		// Simulating: title="Fix bug in parser" priority=high tags=bug,urgent
		const result = parseKV(['title="Fix', 'bug', 'in', 'parser"', 'priority=high', 'tags=bug,urgent']);
		expect(result).toEqual({
			title: 'Fix bug in parser',
			priority: 'high',
			tags: 'bug,urgent',
		});
	});

	it('should handle value with no quotes but containing equals in next field', () => {
		// This is an edge case: unquoted value followed by field with equals
		const result = parseKV(['status=active', 'priority=high']);
		expect(result).toEqual({
			status: 'active',
			priority: 'high',
		});
	});
});
