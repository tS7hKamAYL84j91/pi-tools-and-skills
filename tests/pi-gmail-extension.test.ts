import { describe, it, expect, vi, beforeEach } from "vitest";

interface MockPiApi {
  registerProvider: ReturnType<typeof vi.fn>;
  registerTool: ReturnType<typeof vi.fn>;
}

const mocks = vi.hoisted(() => ({ execFile: vi.fn() }));

vi.mock("node:child_process", () => ({
  execFile: mocks.execFile,
}));

function mockSecret(name: string): string {
  if (name === "gmail-oauth-client") {
    return JSON.stringify({ installed: { client_id: "client-id", client_secret: "client-secret" } });
  }
  if (name === "gmail-refresh-token") {
    return "refresh-token";
  }
  throw new Error(`unexpected secret ${name}`);
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

async function loadTools() {
  vi.resetModules();
  const { default: piGmailExtension } = await import("../extensions/pi-gmail/index");
  const tools: Array<{ name: string; execute: (id: string, params: Record<string, unknown>) => Promise<unknown> }> = [];
  const mockPi = {
    registerProvider: vi.fn(),
    registerTool: vi.fn((tool) => tools.push(tool)),
  } satisfies MockPiApi;
  piGmailExtension(mockPi);
  return { mockPi, tools };
}

describe("gmail extension", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.GMAIL_OAUTH_CLIENT_JSON = mockSecret("gmail-oauth-client");
    process.env.GMAIL_REFRESH_TOKEN = mockSecret("gmail-refresh-token");
    mocks.execFile.mockImplementation((_file, args, _options, callback) => {
      callback(undefined, mockSecret(args[1]), "");
    });
  });

  it("should register tools", async () => {
    const { mockPi } = await loadTools();

    expect(mockPi.registerProvider).not.toHaveBeenCalled();
    expect(mockPi.registerTool).toHaveBeenCalledWith(expect.objectContaining({ name: "gmail_search" }));
    expect(mockPi.registerTool).toHaveBeenCalledWith(expect.objectContaining({ name: "gmail_get_message" }));
  });

  it("refreshes token, verifies exact readonly scope, and searches Gmail metadata", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ access_token: "access-token", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ scope: "https://www.googleapis.com/auth/gmail.readonly" }))
      .mockResolvedValueOnce(jsonResponse({ messages: [{ id: "m1", threadId: "t1" }] }))
      .mockResolvedValueOnce(jsonResponse({ id: "m1", threadId: "t1", snippet: "hello", payload: { headers: [
        { name: "From", value: "a@example.com" },
        { name: "Date", value: "today" },
        { name: "Subject", value: "Subject" },
      ] } }));
    const { tools } = await loadTools();
    const search = tools.find((tool) => tool.name === "gmail_search");

    const result = await search?.execute("1", { query: "in:inbox", maxResults: 1 });

    expect(fetchMock).toHaveBeenCalledWith("https://oauth2.googleapis.com/token", expect.objectContaining({ method: "POST" }));
    expect(fetchMock).toHaveBeenCalledWith("https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=access-token");
    expect(fetchMock).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ headers: { Authorization: "Bearer access-token" } }));
    expect(JSON.stringify(result)).toContain("<external_email>");
    expect(JSON.stringify(result)).toContain("Subject");
  });

  it("fails closed on broader OAuth scope", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ access_token: "access-token", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ scope: "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.modify" }));
    const { tools } = await loadTools();
    const search = tools.find((tool) => tool.name === "gmail_search");

    await expect(search?.execute("1", { query: "in:inbox" })).rejects.toThrow("not exactly gmail.readonly");
  });

  it("reports invalid_grant without exposing secrets", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ error: "invalid_grant" }, false, 400));
    const { tools } = await loadTools();
    const search = tools.find((tool) => tool.name === "gmail_search");

    await expect(search?.execute("1", { query: "in:inbox" })).rejects.toThrow("invalid, expired, or revoked");
  });

  it("uses in-memory access token cache before expiry", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ access_token: "access-token", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ scope: "https://www.googleapis.com/auth/gmail.readonly" }))
      .mockResolvedValue(jsonResponse({ id: "m1", threadId: "t1", snippet: "hello", payload: { headers: [] } }));
    const { tools } = await loadTools();
    const getMessage = tools.find((tool) => tool.name === "gmail_get_message");

    await getMessage?.execute("1", { id: "m1" });
    await getMessage?.execute("2", { id: "m1" });

    expect(fetchMock.mock.calls.filter((call) => call[0] === "https://oauth2.googleapis.com/token")).toHaveLength(1);
  });
});
