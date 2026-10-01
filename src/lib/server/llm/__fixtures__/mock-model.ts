// Test-only helpers for the LLM specs: a mock model that plays back a fixed list
// of replies, and the provider errors those replies can throw. Nothing in the
// app imports this file.
import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import type { LLMProviderConfig } from "../model-factory.js";

// One model reply: a finished answer, an answer cut off by the output length
// limit, an answer that ended for another reason (such as a content filter or
// a provider that reports "other"), an error thrown by the provider, or no
// answer at all until the request is stopped (as a slow provider would).
export type Reply =
  | { text: string }
  | { truncated: string }
  | { text: string; finishReason: "content-filter" | "other" | "error" }
  | { error: unknown }
  | { hang: true };

// Waits until the request's abort signal fires, then fails with its reason, as
// fetch does. A request with no signal would wait for ever, so it fails at once.
function hangUntilAborted(signal: AbortSignal | undefined): Promise<never> {
  if (!signal) {
    return Promise.reject(new Error("A hanging reply needs an abort signal"));
  }
  return new Promise((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    signal.addEventListener("abort", () => reject(signal.reason), {
      once: true,
    });
  });
}

// A mock model that answers each call with the next reply in order, and keeps
// repeating the last one.
export function mockModel(replies: Reply[]): MockLanguageModelV4 {
  let call = 0;
  return new MockLanguageModelV4({
    doGenerate: async ({ abortSignal }) => {
      const reply = replies[Math.min(call++, replies.length - 1)];
      if ("error" in reply) throw reply.error;
      if ("hang" in reply) return hangUntilAborted(abortSignal);
      const truncated = "truncated" in reply;
      const unified = truncated
        ? "length"
        : "finishReason" in reply
          ? reply.finishReason
          : "stop";
      return {
        content: [
          { type: "text", text: truncated ? reply.truncated : reply.text },
        ],
        finishReason: { unified, raw: unified },
        usage: {
          inputTokens: {
            total: 10,
            noCache: 10,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: { total: 10, text: 10, reasoning: undefined },
        },
        warnings: [],
      };
    },
  });
}

export function provider(
  name: string,
  model = `${name}-model`,
): LLMProviderConfig {
  return { type: "groq", name, model, apiKey: "test-key" };
}

export function httpError(statusCode: number, message = `HTTP ${statusCode}`) {
  return new APICallError({
    message,
    url: "https://provider.invalid",
    requestBodyValues: {},
    statusCode,
  });
}

// Whether a recorded model call asked for JSON-schema (structured) output.
export function askedForSchema(
  model: MockLanguageModelV4,
  index: number,
): boolean {
  return model.doGenerateCalls[index]?.responseFormat?.type === "json";
}
