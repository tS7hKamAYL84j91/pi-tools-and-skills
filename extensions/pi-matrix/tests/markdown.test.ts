/** Tests for Matrix Markdown formatting helpers. */

import { describe, expect, it } from "vitest";

import {
	markdownToMatrixContent,
	markdownToMatrixHtml,
	markdownToMatrixPlainText,
} from "../markdown.js";

describe("markdown formatting for Matrix", () => {
	it("converts supported Markdown to Matrix-safe HTML", () => {
		const markdown = [
			"### Status **update**",
			"Plain *italic* <u>under</u> ~~old~~ `x < y`",
			"- first",
			"* second",
			"1. next",
			"> quote",
			"---",
			"```",
			"**not bold** <tag>&",
			"```",
		].join("\n");

		expect(markdownToMatrixHtml(markdown)).toBe(
			"<h3>Status <strong>update</strong></h3>" +
				"<p>Plain <em>italic</em> <u>under</u> <del>old</del> <code>x &lt; y</code></p>" +
				"<ul><li>first</li><li>second</li></ul>" +
				"<ol><li>next</li></ol>" +
				"<blockquote>quote</blockquote>" +
				"<hr />" +
				"<pre><code>**not bold** &lt;tag&gt;&amp;</code></pre>",
		);
	});

	it("builds a readable plain-text fallback", () => {
		expect(markdownToMatrixPlainText("# Title\n- **done**\n2. `next`\n> note\n---")).toBe(
			"Title\n• done\n2. next\n› note\n──────────",
		);
	});

	it("escapes raw HTML except simple underline tags", () => {
		expect(markdownToMatrixHtml("**<tag>** & <u>safe</u>")).toBe(
			"<p><strong>&lt;tag&gt;</strong> &amp; <u>safe</u></p>",
		);
	});

	it("returns Matrix custom HTML event content", () => {
		expect(markdownToMatrixContent("**hello**")).toEqual({
			msgtype: "m.text",
			body: "hello",
			format: "org.matrix.custom.html",
			formatted_body: "<p><strong>hello</strong></p>",
		});
	});
});
