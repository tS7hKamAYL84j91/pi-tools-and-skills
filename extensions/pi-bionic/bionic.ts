/**
 * Clean-room bionic-reading plain-text transform.
 */

export interface BionicTransformOptions {
	fixationPoint?: number;
	sep?: string | [string, string];
	ignoreHtmlTag?: boolean;
	ignoreHtmlEntity?: boolean;
}

interface BionicTransformMetadata {
	wordsTouched: number;
	markerOpen: string;
	markerClose: string;
	fixationPoint: number;
}

interface BionicTransformResult {
	text: string;
	metadata: BionicTransformMetadata;
}

const ESCAPE = String.fromCharCode(27);
const DEFAULT_OPEN = `${ESCAPE}[1m`;
const DEFAULT_CLOSE = `${ESCAPE}[22m`;

function markerPair(sep: string | [string, string] | undefined): [string, string] {
	if (sep === undefined) return [DEFAULT_OPEN, DEFAULT_CLOSE];
	if (typeof sep === "string") return [sep, sep];
	return sep;
}

function normalizedFixationPoint(value: number | undefined): number {
	if (value === undefined || !Number.isInteger(value) || value < 1 || value > 5) return 1;
	return value;
}

function isWordCharacter(value: string): boolean {
	return /^[\p{L}\p{N}]$/u.test(value);
}

function isDigitOnly(value: string): boolean {
	return /^\p{N}+$/u.test(value);
}

function suffixLength(length: number, fixationPoint: number): number {
	if (length <= 1) return length;
	if (fixationPoint === 1) {
		if (length <= 4) return 1;
		if (length <= 12) return 2;
		if (length <= 16) return 3;
		if (length <= 24) return 4;
		if (length <= 29) return 5;
		if (length <= 35) return 6;
		if (length <= 42) return 7;
		if (length <= 48) return 8;
		return 9;
	}
	return Math.min(length - 1, fixationPoint);
}

function markWord(word: string, open: string, close: string, fixationPoint: number): { text: string; touched: boolean } {
	const chars = [...word];
	if (chars.length <= 1 || isDigitOnly(word)) return { text: word, touched: false };
	const prefixLength = chars.length - suffixLength(chars.length, fixationPoint);
	if (prefixLength <= 0) return { text: word, touched: false };
	return {
		text: `${open}${chars.slice(0, prefixLength).join("")}${close}${chars.slice(prefixLength).join("")}`,
		touched: true,
	};
}

function protectedRangeEnd(text: string, index: number, ignoreHtmlTag: boolean, ignoreHtmlEntity: boolean): number | undefined {
	if (ignoreHtmlTag && text[index] === "<") {
		const close = text.indexOf(">", index + 1);
		if (close >= 0) return close + 1;
	}
	if (ignoreHtmlEntity && text[index] === "&") {
		const close = text.indexOf(";", index + 1);
		if (close >= 0) return close + 1;
	}
	return undefined;
}

export function bionicTransform(text: string, options: BionicTransformOptions = {}): BionicTransformResult {
	const [open, close] = markerPair(options.sep);
	const fixationPoint = normalizedFixationPoint(options.fixationPoint);
	const ignoreHtmlTag = options.ignoreHtmlTag !== false;
	const ignoreHtmlEntity = options.ignoreHtmlEntity !== false;
	let output = "";
	let word = "";
	let wordsTouched = 0;
	let index = 0;

	function flushWord(): void {
		if (word === "") return;
		const marked = markWord(word, open, close, fixationPoint);
		output += marked.text;
		if (marked.touched) wordsTouched += 1;
		word = "";
	}

	while (index < text.length) {
		const rangeEnd = protectedRangeEnd(text, index, ignoreHtmlTag, ignoreHtmlEntity);
		if (rangeEnd !== undefined) {
			flushWord();
			output += text.slice(index, rangeEnd);
			index = rangeEnd;
			continue;
		}
		const char = [...text.slice(index)][0];
		if (char === undefined) break;
		if (isWordCharacter(char)) {
			word += char;
		} else {
			flushWord();
			output += char;
		}
		index += char.length;
	}
	flushWord();
	return { text: output, metadata: { wordsTouched, markerOpen: open, markerClose: close, fixationPoint } };
}
