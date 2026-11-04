export interface PaneIdentity {
	sessionName: string;
	paneId: number;
}
export function paneIdentity(
	sessionName: unknown,
	paneId: unknown,
): PaneIdentity | undefined;
export function ownPaneIdentity(input: {
	inside: unknown;
	sessionName: unknown;
	paneId: unknown;
	interactive: boolean;
	parentId?: string;
}): PaneIdentity | undefined;
