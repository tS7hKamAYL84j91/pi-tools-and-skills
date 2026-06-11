/**
 * Send a message to another agent in the fleet via the Maildir registry.
 *
 * Usage:
 *   npx tsx send.ts <recipient-name> "message text"
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findAgentByName, sendAgentMessage } from "../../../lib/agent-api.js";

const SESSION_FILE = join(process.cwd(), ".pi", "mailbox-session.json");

const recipientName = process.argv[2];
const messageText = process.argv[3];

if (!recipientName || !messageText) {
	console.log("Usage: npx tsx send.ts <recipient-name> <message>");
	process.exit(1);
}

let senderName = "external";
if (existsSync(SESSION_FILE)) {
	try {
		const session = JSON.parse(readFileSync(SESSION_FILE, "utf-8"));
		if (session.name) {
			senderName = session.name;
		}
	} catch {
		/* fallback to default */
	}
}

const envName = process.env["AGENT_NAME"];
if (envName) {
	senderName = envName;
}

const recipient = findAgentByName(recipientName);
if (!recipient) {
	console.error(`Error: Agent "${recipientName}" not found in registry.`);
	process.exit(1);
}

if (!recipient.alive) {
	console.log(`Warning: Agent "${recipient.name}" (PID ${recipient.pid}) is not active, but delivering message to queue.`);
}

console.log(`Sending message from "${senderName}" to "${recipient.name}"...`);

const success = await sendAgentMessage(recipient.id, senderName, messageText);
if (success) {
	console.log("Message delivered successfully.");
} else {
	console.error("Failed to deliver message.");
	process.exit(1);
}
