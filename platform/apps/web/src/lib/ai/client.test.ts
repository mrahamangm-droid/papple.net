import { describe, expect, it, vi } from "vitest";
import { AiUnavailableError, createAnthropicClient } from "./client";

const ok = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe("createAnthropicClient", () => {
  it("posts to the Messages API with the key, version and prompt", async () => {
    const f = ok({ content: [{ type: "text", text: "Hello" }], usage: { input_tokens: 11, output_tokens: 7 } });
    const c = createAnthropicClient({ apiKey: "sk-test", model: "m-1", fetchImpl: f as unknown as typeof fetch });
    const r = await c.complete({ system: "sys", user: "usr", maxTokens: 300 });
    expect(r).toEqual({ text: "Hello", tokensIn: 11, tokensOut: 7 });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const h = init.headers as Record<string, string>;
    expect(h["x-api-key"]).toBe("sk-test");
    expect(h["anthropic-version"]).toBe("2023-06-01");
    expect(JSON.parse(init.body as string)).toEqual({ model: "m-1", max_tokens: 300, system: "sys", messages: [{ role: "user", content: "usr" }] });
  });
  it("joins multiple text blocks", async () => {
    const c = createAnthropicClient({ apiKey: "k", model: "m", fetchImpl: ok({ content: [{ type: "text", text: "a" }, { type: "text", text: "b" }], usage: { input_tokens: 1, output_tokens: 1 } }) as unknown as typeof fetch });
    expect((await c.complete({ system: "s", user: "u", maxTokens: 10 })).text).toBe("ab");
  });
  it("throws a generic error on HTTP failure and never leaks the response", async () => {
    const c = createAnthropicClient({ apiKey: "k", model: "m", fetchImpl: ok({ error: { message: "key sk-secret invalid" } }, 401) as unknown as typeof fetch });
    const e = await c.complete({ system: "s", user: "u", maxTokens: 10 }).catch((x) => x);
    expect(e).toBeInstanceOf(AiUnavailableError);
    expect(String(e.message)).not.toContain("sk-secret");
  });
  it("throws on network failure, malformed body and empty text", async () => {
    for (const f of [vi.fn(async () => { throw new Error("socket sk-secret"); }), ok({ nope: true }), ok({ content: [], usage: {} })]) {
      const c = createAnthropicClient({ apiKey: "k", model: "m", fetchImpl: f as unknown as typeof fetch });
      const e = await c.complete({ system: "s", user: "u", maxTokens: 10 }).catch((x) => x);
      expect(e).toBeInstanceOf(AiUnavailableError);
      expect(String(e.message)).not.toContain("sk-secret");
    }
  });
});
