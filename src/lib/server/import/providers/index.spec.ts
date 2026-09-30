// Characterisation tests for the receipt extraction call. They pin what the
// worker sees — the result it gets back, and which providers and modes were
// tried — so the call can move onto the shared structured-call module without
// changing what a user's import produces.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import type { LLMProviderConfig } from "$lib/server/llm/model-factory.js";

const models = vi.hoisted(() => new Map<string, unknown>());

vi.mock("$lib/server/llm/model-factory.js", () => ({
  createModel: vi.fn((config: { name: string }) => {
    const model = models.get(config.name);
    if (!model) throw new Error(`No mock model for ${config.name}`);
    return model;
  }),
}));

vi.mock("$lib/server/llm/rate-limiter.js", () => ({
  throttleLLMCall: vi.fn(async () => {}),
}));

vi.mock("$lib/server/logger.js", () => ({
  createLogger: () => ({
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { callLLMWithProviders } from "./index.js";

type Reply = { text: string } | { error: unknown };

// A mock model that answers each call with the next reply in order.
function mockModel(name: string, replies: Reply[]) {
  let call = 0;
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      const reply = replies[Math.min(call++, replies.length - 1)];
      if ("error" in reply) throw reply.error;
      return {
        content: [{ type: "text", text: reply.text }],
        finishReason: { unified: "stop", raw: "stop" },
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
  models.set(name, model);
  return model;
}

function provider(name: string, model = `${name}-model`): LLMProviderConfig {
  return { type: "groq", name, model, apiKey: "test-key" };
}

function rejected(statusCode: number, message = `HTTP ${statusCode}`) {
  return new APICallError({
    message,
    url: "https://provider.invalid",
    requestBodyValues: {},
    statusCode,
  });
}

// Whether a recorded model call asked for JSON-schema (structured) output.
function asksForSchema(model: MockLanguageModelV4, index: number): boolean {
  return model.doGenerateCalls[index]?.responseFormat?.type === "json";
}

const params = {
  text: "Receipt: Coffee beans 12.50 MYR",
  expenseAccounts: [{ id: 7, code: 6100, path: "Groceries" }],
  incomeAccounts: [{ id: 9, code: 4100, path: "Sales" }],
  mainCurrency: "MYR",
};

const valid = {
  document_type: "expense",
  item_name: "Coffee beans",
  supplier: "Bean Co",
  date: "2026-03-15",
  amount: 12.5,
  currency: "MYR",
  reference: "R-1",
  category_account_id: 7,
};

beforeEach(() => {
  models.clear();
});

describe("callLLMWithProviders", () => {
  it("returns the structured result when the model supports a schema", async () => {
    const model = mockModel("primary", [{ text: JSON.stringify(valid) }]);

    await expect(
      callLLMWithProviders(params, [provider("primary")]),
    ).resolves.toEqual(valid);
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(asksForSchema(model, 0)).toBe(true);
  });

  it("falls back to text on a 400 and keeps that model in text mode", async () => {
    const model = mockModel("strict", [
      { error: rejected(400, "response_format is unsupported") },
      { text: `Here you go: ${JSON.stringify(valid)} Thanks!` },
      { text: JSON.stringify(valid) },
    ]);
    const config = provider("strict", "no-schema-model");

    await expect(callLLMWithProviders(params, [config])).resolves.toEqual(
      valid,
    );
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(asksForSchema(model, 0)).toBe(true);
    expect(asksForSchema(model, 1)).toBe(false);

    // The next document skips the structured attempt for the same model.
    await expect(callLLMWithProviders(params, [config])).resolves.toEqual(
      valid,
    );
    expect(model.doGenerateCalls).toHaveLength(3);
    expect(asksForSchema(model, 2)).toBe(false);
  });

  it("moves to the next provider when one fails for another reason", async () => {
    const bad = mockModel("bad", [{ error: rejected(401, "Invalid API key") }]);
    const good = mockModel("good", [{ text: JSON.stringify(valid) }]);

    await expect(
      callLLMWithProviders(params, [provider("bad"), provider("good")]),
    ).resolves.toEqual(valid);
    expect(bad.doGenerateCalls).toHaveLength(1);
    expect(good.doGenerateCalls).toHaveLength(1);
  });

  it("throws the last provider's error when every provider fails", async () => {
    mockModel("first", [{ error: rejected(401, "Invalid API key") }]);
    mockModel("second", [{ error: rejected(403, "Quota exhausted") }]);

    await expect(
      callLLMWithProviders(params, [provider("first"), provider("second")]),
    ).rejects.toThrow("Quota exhausted");
  });

  it("cleans the model's answer before returning it", async () => {
    mockModel("messy", [
      {
        text: JSON.stringify({
          ...valid,
          item_name: `  ${"Very long description ".repeat(6)}  `,
          supplier: "  Bean Co Sdn Bhd  ",
          amount: -12.5,
          currency: "myr",
          date: "2026-03-15T10:00:00Z",
        }),
      },
    ]);

    const result = await callLLMWithProviders(params, [provider("messy")]);

    expect(result.item_name.length).toBe(80);
    expect(result.item_name.endsWith("…")).toBe(true);
    expect(result.supplier).toBe("Bean Co Sdn Bhd");
    expect(result.amount).toBe(12.5);
    expect(result.currency).toBe("MYR");
    expect(result.date).toBe("2026-03-15");
  });

  it("uses the main currency when the answer has no valid currency code", async () => {
    mockModel("nocurrency", [
      { text: JSON.stringify({ ...valid, currency: "RM" }) },
    ]);

    const result = await callLLMWithProviders(
      { ...params, mainCurrency: "sgd" },
      [provider("nocurrency")],
    );

    expect(result.currency).toBe("SGD");
  });
});
