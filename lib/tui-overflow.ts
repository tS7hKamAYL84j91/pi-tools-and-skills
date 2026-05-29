/**
 * Shared TUI overflow and scroll cue formatting helpers.
 */

export interface ScrollCueArgs {
	visibleCount: number;
	totalCount: number;
	canScrollUp?: boolean;
	canScrollDown?: boolean;
}

function pluralize(count: number, singular: string, plural?: string): string {
	return count === 1 ? singular : (plural ?? `${singular}s`);
}

/** Return the standard scroll cue for a partially visible scrollable list. */
export function formatScrollCue(args: ScrollCueArgs): string | undefined {
	if (args.totalCount <= args.visibleCount || args.totalCount <= 0) {
		return undefined;
	}
	if (args.canScrollUp === true && args.canScrollDown === true) {
		return `[Showing ${args.visibleCount} of ${args.totalCount} - scroll ↑/↓ for more]`;
	}
	if (args.canScrollUp === true) {
		return `[Showing ${args.visibleCount} of ${args.totalCount} - scroll ↑ for more]`;
	}
	if (args.canScrollDown === true) {
		return `[Showing ${args.visibleCount} of ${args.totalCount} - scroll ↓ for more]`;
	}
	return undefined;
}

/** Return a compact hidden-count cue for hard truncation or tight layouts. */
export function formatHiddenCountCue(hiddenCount: number, singularUnit: string, pluralUnit?: string): string | undefined {
	if (hiddenCount <= 0) {
		return undefined;
	}
	return `...+${hiddenCount} more ${pluralize(hiddenCount, singularUnit, pluralUnit)}`;
}
