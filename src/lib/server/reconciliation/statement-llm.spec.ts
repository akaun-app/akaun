import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MockLanguageModelV4 } from "ai/test";
import {
  askedForSchema,
  httpError,
  mockModel,
  provider,
} from "$lib/server/llm/__fixtures__/mock-model.js";

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
  }),
}));

import { extractStatementLines } from "./statement-llm.js";

function register(name: string, model: MockLanguageModelV4) {
  models.set(name, model);
  return model;
}

const validResult = {
  lines: [{ date: "2026-08-01", description: "Salary", amount: 2500 }],
};

beforeEach(() => {
  models.clear();
});

describe("extractStatementLines", () => {
  it("uses provider-native structured output", async () => {
    const model = register(
      "primary",
      mockModel([{ text: JSON.stringify(validResult) }]),
    );

    await expect(
      extractStatementLines("readable statement text", [provider("primary")]),
    ).resolves.toEqual(validResult);
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(askedForSchema(model, 0)).toBe(true);
  });

  it("falls back to schema-validated text when structured output is unsupported", async () => {
    const model = register(
      "fallback",
      mockModel([
        { error: httpError(400, "response_format is unsupported") },
        { text: `Here is the result: ${JSON.stringify(validResult)}` },
      ]),
    );

    await expect(
      extractStatementLines("readable statement text", [
        provider("fallback", "unsupported-model"),
      ]),
    ).resolves.toEqual(validResult);
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(askedForSchema(model, 1)).toBe(false);
  });

  it("tries the next provider when one returns malformed transactions", async () => {
    const bad = register(
      "bad",
      mockModel([{ text: JSON.stringify({ lines: [{ date: "soon" }] }) }]),
    );
    const good = register(
      "good",
      mockModel([{ text: JSON.stringify(validResult) }]),
    );

    await expect(
      extractStatementLines("readable statement text", [
        provider("bad"),
        provider("good"),
      ]),
    ).resolves.toEqual(validResult);
    // The bad provider got its structured try and one text retry.
    expect(bad.doGenerateCalls).toHaveLength(2);
    expect(good.doGenerateCalls).toHaveLength(1);
  });

  it("says every provider failed, keeping the last error as the cause", async () => {
    const lastError = httpError(401, "Invalid API key");
    register("only", mockModel([{ error: lastError }]));

    const failure = await extractStatementLines("readable statement text", [
      provider("only"),
    ]).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(
      "All document extraction providers failed to return valid transactions",
    );
    expect((failure as Error).cause).toBe(lastError);
  });
});
