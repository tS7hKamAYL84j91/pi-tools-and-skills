/** Matrix extension — Markdown to Matrix-safe HTML conversion. */

const MATRIX_HTML_FORMAT = "org.matrix.custom.html";

interface MatrixMarkdownContent {
	[msgtype: string]: string;
	msgtype: "m.text";
	body: string;
	format: typeof MATRIX_HTML_FORMAT;
	formatted_body: string;
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function formatText(text: string): string {
	return escapeHtml(text)
		.replace(/&lt;u&gt;([^\n]*?)&lt;\/u&gt;/g, "<u>$1</u>")
		.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
		.replace(/__([^_\n]+)__/g, "<strong>$1</strong>")
		.replace(/~~([^~\n]+)~~/g, "<del>$1</del>")
		.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "<em>$1</em>")
		.replace(/(?<!_)_([^_\n]+)_(?!_)/g, "<em>$1</em>");
}

function formatInline(text: string): string {
	return text
		.split(/(`[^`\n]+`)/g)
		.map((part) => {
			if (part.startsWith("`") && part.endsWith("`")) {
				return `<code>${escapeHtml(part.slice(1, -1))}</code>`;
			}
			return formatText(part);
		})
		.join("");
}

function stripInline(text: string): string {
	return text
		.replace(/`([^`\n]+)`/g, "$1")
		.replace(/<u>([^\n]*?)<\/u>/g, "$1")
		.replace(/\*\*([^*\n]+)\*\*/g, "$1")
		.replace(/__([^_\n]+)__/g, "$1")
		.replace(/~~([^~\n]+)~~/g, "$1")
		.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "$1")
		.replace(/(?<!_)_([^_\n]+)_(?!_)/g, "$1");
}

function isFence(line: string): boolean {
	return /^```/.test(line);
}

function headingMatch(line: string): RegExpMatchArray | null {
	return line.match(/^(#{1,3})\s+(.+)$/);
}

function horizontalRuleMatch(line: string): boolean {
	return /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line);
}

/** Convert Markdown text into Matrix-safe HTML. */
export function markdownToMatrixHtml(text: string): string {
	const htmlParts: string[] = [];
	let listItems: string[] = [];
	let listTag: "ul" | "ol" | null = null;
	let paragraphLines: string[] = [];
	let codeBlockLines: string[] = [];
	let inCodeBlock = false;

	function flushParagraph(): void {
		if (paragraphLines.length === 0) return;
		htmlParts.push(`<p>${paragraphLines.map(formatInline).join("<br />")}</p>`);
		paragraphLines = [];
	}

	function flushList(): void {
		if (listItems.length === 0 || listTag === null) return;
		htmlParts.push(`<${listTag}>${listItems.join("")}</${listTag}>`);
		listItems = [];
		listTag = null;
	}

	function flushOpenBlocks(): void {
		flushParagraph();
		flushList();
	}

	function flushCodeBlock(): void {
		htmlParts.push(`<pre><code>${escapeHtml(codeBlockLines.join("\n"))}</code></pre>`);
		codeBlockLines = [];
		inCodeBlock = false;
	}

	for (const line of text.split(/\r?\n/)) {
		if (isFence(line)) {
			flushOpenBlocks();
			if (inCodeBlock) flushCodeBlock();
			else inCodeBlock = true;
			continue;
		}

		if (inCodeBlock) {
			codeBlockLines.push(line);
			continue;
		}

		if (line.trim() === "") {
			flushOpenBlocks();
			continue;
		}

		const heading = headingMatch(line);
		if (heading !== null) {
			flushOpenBlocks();
			const level = heading[1]?.length ?? 1;
			htmlParts.push(`<h${level}>${formatInline(heading[2] ?? "")}</h${level}>`);
			continue;
		}

		if (horizontalRuleMatch(line)) {
			flushOpenBlocks();
			htmlParts.push("<hr />");
			continue;
		}

		const quoteMatch = line.match(/^>\s?(.*)$/);
		if (quoteMatch !== null) {
			flushOpenBlocks();
			htmlParts.push(`<blockquote>${formatInline(quoteMatch[1] ?? "")}</blockquote>`);
			continue;
		}

		const unorderedMatch = line.match(/^\s*[-*]\s+(.+)$/);
		const orderedMatch = line.match(/^\s*\d+[.)]\s+(.+)$/);
		const itemText = unorderedMatch?.[1] ?? orderedMatch?.[1];
		if (itemText !== undefined) {
			flushParagraph();
			const nextListTag = unorderedMatch !== null ? "ul" : "ol";
			if (listTag !== null && listTag !== nextListTag) flushList();
			listTag = nextListTag;
			listItems.push(`<li>${formatInline(itemText)}</li>`);
			continue;
		}

		flushList();
		paragraphLines.push(line);
	}

	if (inCodeBlock) flushCodeBlock();
	flushOpenBlocks();
	return htmlParts.join("");
}

/** Build the plain-text fallback body for a Matrix Markdown message. */
export function markdownToMatrixPlainText(text: string): string {
	const output: string[] = [];
	let inCodeBlock = false;

	for (const line of text.split(/\r?\n/)) {
		if (isFence(line)) {
			inCodeBlock = !inCodeBlock;
			continue;
		}
		if (inCodeBlock) {
			output.push(line);
			continue;
		}
		if (line.trim() === "") continue;
		const heading = headingMatch(line);
		if (heading !== null) {
			output.push(stripInline(heading[2] ?? ""));
			continue;
		}
		if (horizontalRuleMatch(line)) {
			output.push("──────────");
			continue;
		}
		const quoteMatch = line.match(/^>\s?(.*)$/);
		if (quoteMatch !== null) {
			output.push(`› ${stripInline(quoteMatch[1] ?? "")}`);
			continue;
		}
		const unorderedMatch = line.match(/^\s*[-*]\s+(.+)$/);
		if (unorderedMatch !== null) {
			output.push(`• ${stripInline(unorderedMatch[1] ?? "")}`);
			continue;
		}
		const orderedMatch = line.match(/^\s*(\d+)[.)]\s+(.+)$/);
		if (orderedMatch !== null) {
			output.push(`${orderedMatch[1] ?? "1"}. ${stripInline(orderedMatch[2] ?? "")}`);
			continue;
		}
		output.push(stripInline(line));
	}

	return output.join("\n");
}

/** Build a complete Matrix m.text event content object from Markdown. */
export function markdownToMatrixContent(text: string): MatrixMarkdownContent {
	return {
		msgtype: "m.text",
		body: markdownToMatrixPlainText(text),
		format: MATRIX_HTML_FORMAT,
		formatted_body: markdownToMatrixHtml(text),
	};
}
