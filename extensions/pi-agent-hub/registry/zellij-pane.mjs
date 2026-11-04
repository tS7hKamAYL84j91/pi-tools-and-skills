/** Navigation hints only: never permissions or execution authority. */
export function paneIdentity(sessionName, paneId) {
	if (
		typeof sessionName !== "string" ||
		!/^[a-zA-Z0-9][a-zA-Z0-9._ -]{0,127}$/.test(sessionName)
	)
		return undefined;
	if (typeof paneId !== "string" || !/^(?:terminal_)?[0-9]+$/.test(paneId))
		return undefined;
	const id = Number(paneId.replace(/^terminal_/, ""));
	if (!Number.isSafeInteger(id) || id < 0) return undefined;
	return { sessionName, paneId: id };
}

/** Headless/RPC children must not advertise an inherited parent terminal. */
export function ownPaneIdentity({
	inside,
	sessionName,
	paneId,
	interactive,
	parentId,
}) {
	if (typeof inside !== "string" || !inside || !interactive || parentId)
		return undefined;
	return paneIdentity(sessionName, paneId);
}
