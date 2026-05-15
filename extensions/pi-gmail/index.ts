/**
 * Gmail read-only extension.
 *
 * Implements Gmail metadata search and message fetching with OAuth authentication.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Type } from "@sinclair/typebox";

const execFileAsync = promisify(execFile);
const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const TOKENINFO_URL = "https://www.googleapis.com/oauth2/v1/tokeninfo";
const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const EXPIRY_SKEW_MS = 60_000;
const EXTERNAL_EMAIL_OPEN = "<external_email>";
const EXTERNAL_EMAIL_CLOSE = "</external_email>";

interface PiApi {
  registerTool(tool: unknown): void;
}

interface GoogleOAuthClient {
  clientId: string;
  clientSecret: string;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface TokenInfoResponse {
  scope?: string;
  error?: string;
}

interface CachedAccessToken {
  token: string;
  expiresAt: number;
}

interface GmailListResponse {
  messages?: Array<{ id?: string; threadId?: string }>;
}

interface GmailHeader {
  name?: string;
  value?: string;
}

interface GmailMessagePart {
  headers?: GmailHeader[];
}

interface GmailMessageResponse {
  id?: string;
  threadId?: string;
  snippet?: string;
  payload?: GmailMessagePart;
}

interface GmailSearchParams {
  query: string;
  maxResults?: number;
}

interface GmailGetMessageParams {
  id: string;
}

let cachedAccessToken: CachedAccessToken | undefined;

function secretCommand(): string {
  return process.env.PI_GMAIL_SECRET_COMMAND ?? process.env.COAS_SECRETS_COMMAND ?? process.env.COAS_SECRETS ?? "coas-secrets";
}

function wrapExternalEmail(content: string): string {
  return `${EXTERNAL_EMAIL_OPEN}\n${content}\n${EXTERNAL_EMAIL_CLOSE}`;
}

async function readSecret(name: string): Promise<string> {
  const envValue = name === "gmail-oauth-client" ? process.env.GMAIL_OAUTH_CLIENT_JSON : process.env.GMAIL_REFRESH_TOKEN;
  if (envValue) {
    return envValue;
  }
  try {
    const { stdout } = await execFileAsync(secretCommand(), ["get", name], { encoding: "utf8" });
    return stdout.trim();
  } catch {
    // Do not surface command stderr because secret helpers may include sensitive context.
    throw new Error(
      `Missing Gmail secret '${name}'. Set GMAIL_OAUTH_CLIENT_JSON/GMAIL_REFRESH_TOKEN or configure PI_GMAIL_SECRET_COMMAND.`,
    );
  }
}

function parseOAuthClient(rawJson: string): GoogleOAuthClient {
  const parsed = JSON.parse(rawJson) as {
    installed?: { client_id?: string; client_secret?: string };
    web?: { client_id?: string; client_secret?: string };
    client_id?: string;
    client_secret?: string;
  };
  const client = parsed.installed ?? parsed.web ?? parsed;
  if (!client.client_id || !client.client_secret) {
    throw new Error("Gmail OAuth client secret is missing client_id or client_secret.");
  }
  return { clientId: client.client_id, clientSecret: client.client_secret };
}

async function verifyReadonlyScope(accessToken: string): Promise<void> {
  const response = await fetch(`${TOKENINFO_URL}?access_token=${encodeURIComponent(accessToken)}`);
  const data = (await response.json()) as TokenInfoResponse;
  if (!response.ok || data.error) {
    throw new Error("Unable to verify Gmail OAuth token scope.");
  }
  const scopes = new Set((data.scope ?? "").split(/\s+/).filter(Boolean));
  if (scopes.size !== 1 || !scopes.has(GMAIL_READONLY_SCOPE)) {
    throw new Error("Gmail OAuth token scope is not exactly gmail.readonly; refusing access.");
  }
}

async function mintAccessToken(): Promise<CachedAccessToken> {
  const [client, refreshToken] = await Promise.all([
    readSecret("gmail-oauth-client").then(parseOAuthClient),
    readSecret("gmail-refresh-token"),
  ]);
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const data = (await response.json()) as TokenResponse;
  if (!response.ok || data.error || !data.access_token || !data.expires_in) {
    if (data.error === "invalid_grant") {
      throw new Error("Gmail refresh token is invalid, expired, or revoked. Re-authorize Gmail OAuth.");
    }
    throw new Error("Unable to refresh Gmail access token.");
  }
  await verifyReadonlyScope(data.access_token);
  return { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
}

async function getAccessToken(): Promise<string> {
  if (cachedAccessToken && cachedAccessToken.expiresAt - EXPIRY_SKEW_MS > Date.now()) {
    return cachedAccessToken.token;
  }
  cachedAccessToken = await mintAccessToken();
  return cachedAccessToken.token;
}

async function gmailGet<T>(path: string, params: Record<string, string | number | string[]>): Promise<T> {
  const accessToken = await getAccessToken();
  const url = new URL(`${GMAIL_API_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        url.searchParams.append(key, item);
      }
    } else {
      url.searchParams.set(key, String(value));
    }
  }
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) {
    throw new Error(`Gmail read-only API request failed with HTTP ${response.status}.`);
  }
  return (await response.json()) as T;
}

function headerValue(headers: GmailHeader[] | undefined, name: string): string {
  return headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function formatMetadata(message: GmailMessageResponse): string {
  const headers = message.payload?.headers;
  return [
    `id: ${message.id ?? ""}`,
    `threadId: ${message.threadId ?? ""}`,
    `from: ${headerValue(headers, "from")}`,
    `date: ${headerValue(headers, "date")}`,
    `subject: ${headerValue(headers, "subject")}`,
    `snippet: ${message.snippet ?? ""}`,
  ].join("\n");
}

export default function piGmailExtension(pi: PiApi): void {
  pi.registerTool({
    name: "gmail_search",
    label: "Gmail Search",
    description: "Search live Gmail messages (read-only metadata/snippets).",
    parameters: Type.Object({
      query: Type.String({ description: "Gmail search query" }),
      maxResults: Type.Optional(Type.Number({ description: "Maximum messages to return", minimum: 1, maximum: 50 })),
    }),
    async execute(_id: string, params: GmailSearchParams) {
      const maxResults = params.maxResults ?? 10;
      const list = await gmailGet<GmailListResponse>("/messages", { q: params.query, maxResults });
      const messages = list.messages ?? [];
      const metadata = await Promise.all(
        messages.map((message) =>
          gmailGet<GmailMessageResponse>(`/messages/${message.id ?? ""}`, {
            format: "metadata",
            metadataHeaders: ["From", "Date", "Subject"],
          }),
        ),
      );
      return {
        content: [{ type: "text", text: wrapExternalEmail(metadata.map(formatMetadata).join("\n\n")) }],
        details: { query: params.query, resultCount: messages.length },
      };
    },
  });

  pi.registerTool({
    name: "gmail_get_message",
    label: "Gmail Get Message",
    description: "Fetch live Gmail message metadata and snippet (read-only).",
    parameters: Type.Object({
      id: Type.String({ description: "Message ID" }),
    }),
    async execute(_id: string, params: GmailGetMessageParams) {
      const message = await gmailGet<GmailMessageResponse>(`/messages/${params.id}`, {
        format: "metadata",
        metadataHeaders: ["From", "Date", "Subject"],
      });
      return {
        content: [{ type: "text", text: wrapExternalEmail(formatMetadata(message)) }],
        details: { messageId: params.id, threadId: message.threadId },
      };
    },
  });
}
