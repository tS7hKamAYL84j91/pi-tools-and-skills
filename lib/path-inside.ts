/** Generic path-containment helpers. */

import { isAbsolute, join, relative, resolve } from "node:path";

export function pathInside(parent: string, child: string): boolean {
	const pathFromParent = relative(resolve(parent), resolve(child));
	return pathFromParent === "" || (!pathFromParent.startsWith("..") && !isAbsolute(pathFromParent));
}

export function assertInside(parent: string, child: string): void {
	if (!pathInside(parent, child)) throw new Error(`Path escapes ${parent}: ${child}`);
}

export function joinPath(parent: string, ...segments: string[]): string {
	return join(parent, ...segments);
}
