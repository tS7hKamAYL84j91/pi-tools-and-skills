/**
 * Matrix extension — safe attachment ingestion helpers.
 *
 * Handles Matrix media event metadata, MIME and size gates, MXC downloads,
 * optional SDK encrypted-media decryption, and local cache writes.
 */

import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { writeFileAtomic } from "../../lib/file-persistence.js";
import type { InboundAttachment } from "../../lib/message-transport.js";
import type { MatrixConfig } from "./types.js";

const UNSAFE_FILENAME_RE = /[^\w .@()+,=-]/g;
const UNSAFE_SEGMENT_RE = /[^\w.@+=-]/g;

const MATRIX_MEDIA_MSGTYPES = ["m.image", "m.file", "m.audio", "m.video"] as const;

type MatrixMediaMsgtype = (typeof MATRIX_MEDIA_MSGTYPES)[number];

interface MatrixEncryptedFile {
	url: string;
	[key: string]: unknown;
}

interface MatrixMediaInfo {
	size?: number;
	mimetype?: string;
}

interface MatrixMessageContent {
	body?: string;
	msgtype?: string;
	url?: string;
	file?: MatrixEncryptedFile;
	info?: MatrixMediaInfo;
}

export interface MatrixRoomMessageEvent {
	sender?: string;
	event_id?: string;
	origin_server_ts?: number;
	content?: MatrixMessageContent;
}

export interface MatrixDownloadClient {
	crypto?: {
		decryptMedia(file: MatrixEncryptedFile): Promise<Buffer>;
	} | null;
}

export function isMatrixMediaMsgtype(msgtype: string): msgtype is MatrixMediaMsgtype {
	return MATRIX_MEDIA_MSGTYPES.includes(msgtype as MatrixMediaMsgtype);
}

function isAllowedMimeType(mimeType: string | undefined, allowedMimePrefixes: string[]): boolean {
	if (allowedMimePrefixes.length === 0) return true;
	if (!mimeType) return false;
	const normalized = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
	return allowedMimePrefixes.some((prefix) => {
		const normalizedPrefix = prefix.toLowerCase();
		return normalizedPrefix.endsWith("/")
			? normalized.startsWith(normalizedPrefix)
			: normalized === normalizedPrefix;
	});
}

function sanitizeFilename(rawName: string | undefined, fallback: string): string {
	const withoutControl = removeControlChars(rawName ?? "").trim();
	const base = basename(withoutControl).replace(UNSAFE_FILENAME_RE, "_").replace(/^\.+$/, "");
	const candidate = base.length > 0 ? base : fallback;
	return candidate.slice(0, 160);
}

function sanitizeSegment(raw: string): string {
	const sanitized = removeControlChars(raw).replace(UNSAFE_SEGMENT_RE, "_").slice(0, 120);
	return sanitized.length > 0 ? sanitized : "unknown";
}

function removeControlChars(value: string): string {
	let cleaned = "";
	for (const char of value) {
		const code = char.charCodeAt(0);
		if ((code >= 32 && code !== 127) || code > 255) cleaned += char;
	}
	return cleaned;
}

function getKind(msgtype: MatrixMediaMsgtype): InboundAttachment["kind"] {
	if (msgtype === "m.image") return "image";
	if (msgtype === "m.audio") return "audio";
	if (msgtype === "m.video") return "video";
	return "file";
}

function formatBytes(bytes: number | undefined): string {
	if (bytes === undefined) return "unknown size";
	if (bytes < 1024) return `${bytes} B`;
	const kibibytes = bytes / 1024;
	if (kibibytes < 1024) return `${kibibytes.toFixed(1)} KiB`;
	return `${(kibibytes / 1024).toFixed(1)} MiB`;
}

function attachmentError(attachment: InboundAttachment, reason: string, nextAction: string): string {
	const mimeType = attachment.mimeType ?? "unknown type";
	return `Attachment "${attachment.filename}" (${mimeType}, ${formatBytes(attachment.sizeBytes)}) was skipped: ${reason}. Next action: ${nextAction}`;
}

function baseAttachment(
	roomId: string,
	event: MatrixRoomMessageEvent,
	content: MatrixMessageContent,
	msgtype: MatrixMediaMsgtype,
): InboundAttachment {
	const eventId = event.event_id ?? `${roomId}-${Date.now()}`;
	const filename = sanitizeFilename(content.body, `${getKind(msgtype)}-${sanitizeSegment(eventId)}`);
	return {
		kind: getKind(msgtype),
		filename,
		mimeType: content.info?.mimetype,
		sizeBytes: content.info?.size,
		mxcUrl: content.file?.url ?? content.url,
		eventId,
		roomId,
		senderMxid: event.sender,
		timestampMs: event.origin_server_ts ?? Date.now(),
		encrypted: content.file !== undefined,
	};
}

async function writeAttachment(config: MatrixConfig, attachment: InboundAttachment, data: Buffer): Promise<string> {
	const eventDir = join(
		config.attachmentCachePath,
		sanitizeSegment(attachment.roomId ?? "unknown-room"),
		sanitizeSegment(attachment.eventId),
	);
	await mkdir(eventDir, { recursive: true });
	const localPath = join(eventDir, sanitizeFilename(attachment.filename, "attachment"));
	await writeFileAtomic(localPath, data);
	return localPath;
}

export async function extractMatrixAttachment(
	config: MatrixConfig,
	client: MatrixDownloadClient,
	roomId: string,
	event: MatrixRoomMessageEvent,
): Promise<InboundAttachment | null> {
	const content = event.content;
	const msgtype = content?.msgtype;
	if (!content || !msgtype || !isMatrixMediaMsgtype(msgtype)) return null;

	const attachment = baseAttachment(roomId, event, content, msgtype);
	if (!attachment.mxcUrl) {
		return {
			...attachment,
			error: attachmentError(attachment, "the Matrix event did not include an mxc:// URL", "ask the sender to resend the file"),
		};
	}
	if (attachment.sizeBytes !== undefined && attachment.sizeBytes > config.maxAttachmentBytes) {
		return {
			...attachment,
			error: attachmentError(
				attachment,
				`size exceeds maxAttachmentBytes (${attachment.sizeBytes} > ${config.maxAttachmentBytes})`,
				`ask the sender to resend below ${formatBytes(config.maxAttachmentBytes)} or raise pi-matrix.maxAttachmentBytes`,
			),
		};
	}
	if (!isAllowedMimeType(attachment.mimeType, config.allowedMimePrefixes)) {
		return {
			...attachment,
			error: attachmentError(
				attachment,
				`MIME type not allowed (${attachment.mimeType ?? "missing"})`,
				"update pi-matrix.allowedMimePrefixes or ask for an allowed file type",
			),
		};
	}

	if (attachment.encrypted) {
		const cryptoStatus = client.crypto?.decryptMedia ? "SDK crypto is available, but" : "SDK crypto is unavailable and";
		return {
			...attachment,
			error: attachmentError(
				attachment,
				`Encrypted Matrix media download is deferred because ${cryptoStatus} matrix-bot-sdk decryptMedia does not expose a bounded download path`,
				"use an unencrypted room/file or download the attachment outside pi",
			),
		};
	}

	try {
		const data = await downloadUnencryptedMedia(config, attachment.mxcUrl);
		const mimeType = attachment.mimeType ?? data.contentType;
		if (!isAllowedMimeType(data.contentType, config.allowedMimePrefixes)) {
			const failedAttachment = { ...attachment, mimeType, sizeBytes: data.buffer.length };
			return {
				...failedAttachment,
				error: attachmentError(
					failedAttachment,
					`MIME type not allowed (${data.contentType ?? "missing"})`,
					"update pi-matrix.allowedMimePrefixes or ask for an allowed file type",
				),
			};
		}
		if (data.buffer.length > config.maxAttachmentBytes) {
			const failedAttachment = { ...attachment, mimeType, sizeBytes: data.buffer.length };
			return {
				...failedAttachment,
				error: attachmentError(
					failedAttachment,
					`size exceeds maxAttachmentBytes (${data.buffer.length} > ${config.maxAttachmentBytes})`,
					`ask the sender to resend below ${formatBytes(config.maxAttachmentBytes)} or raise pi-matrix.maxAttachmentBytes`,
				),
			};
		}
		const localPath = await writeAttachment(config, attachment, data.buffer);
		return { ...attachment, mimeType, sizeBytes: data.buffer.length, localPath };
	} catch (err) {
		return {
			...attachment,
			error: attachmentError(
				attachment,
				err instanceof Error ? err.message : String(err),
				"verify homeserver media access or ask the sender to resend",
			),
		};
	}
}

async function downloadUnencryptedMedia(
	config: MatrixConfig,
	mxcUrl: string,
): Promise<{ buffer: Buffer; contentType?: string }> {
	const mediaUrl = matrixMediaDownloadUrl(config.homeserver, mxcUrl);
	const response = await fetch(mediaUrl, {
		headers: { Authorization: `Bearer ${config.accessToken}` },
	});
	if (!response.ok) throw new Error(`Matrix media download failed: HTTP ${response.status}`);

	const declaredLength = Number(response.headers.get("content-length"));
	if (Number.isFinite(declaredLength) && declaredLength > config.maxAttachmentBytes) {
		throw new Error(`Attachment exceeds maxAttachmentBytes (${declaredLength} > ${config.maxAttachmentBytes}).`);
	}
	if (!response.body) throw new Error("Matrix media download response did not include a body.");

	const chunks: Buffer[] = [];
	let totalBytes = 0;
	const reader = response.body.getReader();
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		totalBytes += value.byteLength;
		if (totalBytes > config.maxAttachmentBytes) {
			throw new Error(`Attachment exceeds maxAttachmentBytes (${totalBytes} > ${config.maxAttachmentBytes}).`);
		}
		chunks.push(Buffer.from(value));
	}

	return {
		buffer: Buffer.concat(chunks, totalBytes),
		contentType: response.headers.get("content-type") ?? undefined,
	};
}

function matrixMediaDownloadUrl(homeserver: string, mxcUrl: string): string {
	if (!mxcUrl.toLowerCase().startsWith("mxc://")) throw new Error("Matrix media URL must start with mxc://.");
	const withoutScheme = mxcUrl.slice("mxc://".length);
	const separatorIndex = withoutScheme.indexOf("/");
	if (separatorIndex <= 0 || separatorIndex === withoutScheme.length - 1) {
		throw new Error("Matrix media URL must include a server name and media id.");
	}
	const serverName = withoutScheme.slice(0, separatorIndex);
	const mediaId = withoutScheme.slice(separatorIndex + 1).split("/")[0];
	if (!mediaId) throw new Error("Matrix media URL must include a media id.");
	const baseUrl = homeserver.replace(/\/+$/, "");
	return `${baseUrl}/_matrix/client/v1/media/download/${encodeURIComponent(serverName)}/${encodeURIComponent(mediaId)}?allow_remote=true`;
}
