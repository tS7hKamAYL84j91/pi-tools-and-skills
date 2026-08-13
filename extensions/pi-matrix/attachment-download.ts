/** Matrix attachment download and bounded-resource plumbing. */

import { AttachmentDownloadResources } from "./resource-bounds.js";
import type { MatrixConfig } from "./types.js";

const ATTACHMENT_DOWNLOAD_CONCURRENCY = 4;
const ATTACHMENT_DOWNLOAD_TIMEOUT_MS = 30_000;
const MAX_PENDING_ATTACHMENT_DOWNLOADS = 32;
const DEFAULT_DOWNLOAD_RESOURCES = new WeakMap<MatrixConfig, AttachmentDownloadResources>();

interface DownloadedMatrixMedia {
	buffer: Buffer;
	contentType?: string;
}

interface MatrixAttachmentDownloadOptions {
	config: MatrixConfig;
	mxcUrl: string;
	downloadResources?: AttachmentDownloadResources;
	lifecycleSignal?: AbortSignal;
	timeoutMs?: number;
}

/** Creates the per-client attachment resource budget. */
export function createAttachmentDownloadResources(config: MatrixConfig): AttachmentDownloadResources {
	return new AttachmentDownloadResources(
		ATTACHMENT_DOWNLOAD_CONCURRENCY,
		config.maxAttachmentBytes * ATTACHMENT_DOWNLOAD_CONCURRENCY,
		MAX_PENDING_ATTACHMENT_DOWNLOADS,
	);
}

/** Holds download resources until the caller finishes validating and caching media. */
export async function withDownloadedMatrixMedia<T>(
	options: MatrixAttachmentDownloadOptions,
	consume: (media: DownloadedMatrixMedia) => Promise<T>,
): Promise<T> {
	const {
		config,
		mxcUrl,
		downloadResources = resourcesFor(config),
		lifecycleSignal,
		timeoutMs = ATTACHMENT_DOWNLOAD_TIMEOUT_MS,
	} = options;
	const timeoutController = new AbortController();
	const deadline = setTimeout(
		() => timeoutController.abort(new Error(`Matrix attachment download timed out after ${timeoutMs}ms.`)),
		timeoutMs,
	);
	deadline.unref();
	const signal = lifecycleSignal
		? AbortSignal.any([lifecycleSignal, timeoutController.signal])
		: timeoutController.signal;

	try {
		return await downloadResources.run(
			config.maxAttachmentBytes,
			signal,
			async () => consume(await downloadUnencryptedMedia(config, mxcUrl, signal)),
		);
	} finally {
		clearTimeout(deadline);
	}
}

async function downloadUnencryptedMedia(
	config: MatrixConfig,
	mxcUrl: string,
	signal: AbortSignal,
): Promise<DownloadedMatrixMedia> {
	const mediaUrl = matrixMediaDownloadUrl(config.homeserver, mxcUrl);
	const response = await fetch(mediaUrl, {
		headers: { Authorization: `Bearer ${config.accessToken}` },
		signal,
	});
	if (!response.body) {
		if (!response.ok) throw new Error(`Matrix media download failed: HTTP ${response.status}`);
		throw new Error("Matrix media download response did not include a body.");
	}

	const chunks: Buffer[] = [];
	let totalBytes = 0;
	let streamSucceeded = false;
	const reader = response.body.getReader();
	const abortRead = () => {
		void reader.cancel(signal.reason).catch(() => {});
	};
	signal.addEventListener("abort", abortRead, { once: true });
	try {
		if (!response.ok) throw new Error(`Matrix media download failed: HTTP ${response.status}`);
		const declaredLength = Number(response.headers.get("content-length"));
		if (Number.isFinite(declaredLength) && declaredLength > config.maxAttachmentBytes) {
			throw new Error(`Attachment exceeds maxAttachmentBytes (${declaredLength} > ${config.maxAttachmentBytes}).`);
		}
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			totalBytes += value.byteLength;
			if (totalBytes > config.maxAttachmentBytes) {
				throw new Error(`Attachment exceeds maxAttachmentBytes (${totalBytes} > ${config.maxAttachmentBytes}).`);
			}
			chunks.push(Buffer.from(value));
		}
		signal.throwIfAborted();
		streamSucceeded = true;
		return {
			buffer: Buffer.concat(chunks, totalBytes),
			contentType: response.headers.get("content-type") ?? undefined,
		};
	} finally {
		signal.removeEventListener("abort", abortRead);
		if (!streamSucceeded) {
			await reader.cancel(signal.reason).catch(() => {});
		}
		reader.releaseLock();
	}
}

function resourcesFor(config: MatrixConfig): AttachmentDownloadResources {
	const existing = DEFAULT_DOWNLOAD_RESOURCES.get(config);
	if (existing) return existing;
	const resources = createAttachmentDownloadResources(config);
	DEFAULT_DOWNLOAD_RESOURCES.set(config, resources);
	return resources;
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
