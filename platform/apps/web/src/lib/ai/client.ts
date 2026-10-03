export class AiUnavailableError extends Error {
  constructor() { super("The AI assistant is temporarily unavailable."); this.name = "AiUnavailableError"; }
}

export interface AiCompletion { text: string; tokensIn: number; tokensOut: number }
export interface AiClient { complete(i: { system: string; user: string; maxTokens: number }): Promise<AiCompletion> }

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

/** Anthropic Messages API over fetch. Every failure becomes a generic AiUnavailableError: provider text and keys never surface. */
export function createAnthropicClient(o: { apiKey: string; model: string; fetchImpl?: typeof fetch; timeoutMs?: number; baseUrl?: string }): AiClient {
  const f = o.fetchImpl ?? fetch;
  return {
    async complete({ system, user, maxTokens }) {
      let res: Response;
      try {
        res = await f(`${o.baseUrl ?? "https://api.anthropic.com"}/v1/messages`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": o.apiKey, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({ model: o.model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
          signal: AbortSignal.timeout(o.timeoutMs ?? 30_000),
        });
      } catch {
        throw new AiUnavailableError();
      }
      if (!res.ok) throw new AiUnavailableError();
      let body: { content?: { type?: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
      try { body = await res.json(); } catch { throw new AiUnavailableError(); }
      const text = (body.content ?? []).filter((b) => b.type === "text" && typeof b.text === "string").map((b) => b.text).join("");
      if (!text.trim()) throw new AiUnavailableError();
      return { text, tokensIn: num(body.usage?.input_tokens), tokensOut: num(body.usage?.output_tokens) };
    },
  };
}
