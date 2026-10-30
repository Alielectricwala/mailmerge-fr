import { afterEach, describe, it, expect, vi } from "vitest";
import { buildPrompt, draftWithGemini } from "./template-ai.js";
import type { WriterField } from "../../shared/template-writer.js";

const fields: WriterField[] = [
  { name: "firstName", label: "First name", coverage: 0.8, custom: false },
  { name: "company", label: "Company", coverage: 1, custom: false },
  { name: "rooms", label: "rooms", coverage: 0.5, custom: true },
];
const ctx = { fields, totalContacts: 40 };
const input = { brief: "Introduce our revenue-management service to boutique hotels", tone: "warm" as const, length: "short" as const, signOff: "Asha, FocusRealm" };
const opts = { apiKey: "test-key", model: "gemini-test", baseUrl: "https://gemini.test" };

function reply(status: number, body: unknown) {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}
const answer = (obj: unknown, extra: Record<string, unknown> = {}) => ({
  candidates: [{ content: { parts: [{ text: "thinking…", thought: true }, { text: JSON.stringify(obj) }] }, finishReason: "STOP", ...extra }],
});

afterEach(() => vi.unstubAllGlobals());

describe("buildPrompt", () => {
  it("describes fields by name and coverage only", () => {
    const prompt = buildPrompt(input, fields, 40);
    expect(prompt).toContain("- firstName: First name (80% of contacts have it)");
    expect(prompt).toContain("- rooms: rooms (50% of contacts have it)");
    expect(prompt).toContain("Asha, FocusRealm");
    expect(prompt).toContain("60–90 words");
    expect(buildPrompt(input, [...fields, { name: "phone", label: "Phone", coverage: 0, custom: false }], 40)).not.toContain("- phone");
  });
});

describe("draftWithGemini", () => {
  it("sends a structured-output request and returns a reviewed draft", async () => {
    const fetchMock = reply(200, answer({ name: "Hotel intro", subject: "An idea for {{company}}", body: "Hi {{firstName}},\r\n\n\n\nWe help hotels with {{rooms}} rooms.  \n\nAsha" }));
    vi.stubGlobal("fetch", fetchMock);
    const draft = await draftWithGemini(input, ctx, opts);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://gemini.test/v1beta/models/gemini-test:generateContent");
    expect(init.headers["x-goog-api-key"]).toBe("test-key");
    const sent = JSON.parse(init.body);
    expect(sent.generationConfig.responseMimeType).toBe("application/json");
    expect(sent.generationConfig.responseJsonSchema.required).toEqual(["name", "subject", "body"]);
    expect(sent.generationConfig).not.toHaveProperty("temperature");
    expect(sent.systemInstruction.parts[0].text).toMatch(/Never invent a field/);

    expect(draft).toMatchObject({ name: "Hotel intro", subject: "An idea for {{company}}", body: "Hi {{firstName}},\n\nWe help hotels with {{rooms}} rooms.\n\nAsha", source: "gemini", model: "gemini-test" });
    expect(draft.warnings).toHaveLength(2); // firstName and rooms lack fallbacks; company is on every contact
  });

  it("explains blocked briefs, rate limits, bad keys and unusable output", async () => {
    vi.stubGlobal("fetch", reply(200, { promptFeedback: { blockReason: "SAFETY" } }));
    await expect(draftWithGemini(input, ctx, opts)).rejects.toMatchObject({ code: "AI_DECLINED", statusCode: 422 });

    vi.stubGlobal("fetch", reply(429, { error: { message: "Resource exhausted" } }));
    await expect(draftWithGemini(input, ctx, opts)).rejects.toMatchObject({ code: "AI_RATE_LIMITED", statusCode: 429 });

    vi.stubGlobal("fetch", reply(400, { error: { message: "API key not valid. Please pass a valid API key." } }));
    await expect(draftWithGemini(input, ctx, opts)).rejects.toMatchObject({ code: "AI_MISCONFIGURED" });

    vi.stubGlobal("fetch", reply(200, { candidates: [{ content: { parts: [{ text: "not json" }] }, finishReason: "STOP" }] }));
    await expect(draftWithGemini(input, ctx, opts)).rejects.toMatchObject({ code: "AI_BAD_OUTPUT" });

    vi.stubGlobal("fetch", reply(200, answer({ name: "x", subject: "Hi {{first name}}", body: "Hello" })));
    await expect(draftWithGemini(input, ctx, opts)).rejects.toMatchObject({ code: "AI_BAD_OUTPUT" });

    vi.stubGlobal("fetch", reply(200, answer({ name: "x", subject: "s", body: "b" }, { finishReason: "MAX_TOKENS" })));
    await expect(draftWithGemini(input, ctx, opts)).rejects.toThrow(/too long/);
  });

  it("refuses to run without a key", async () => {
    await expect(draftWithGemini(input, ctx, { ...opts, apiKey: "" })).rejects.toMatchObject({ code: "AI_DISABLED" });
  });
});
