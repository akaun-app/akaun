import { beforeEach, describe, expect, it, vi } from "vitest";
import { APICallError } from "ai";

const mocks = vi.hoisted(() => ({
  generateObject: vi.fn(),
  generateText: vi.fn(),
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateObject: mocks.generateObject,
    generateText: mocks.generateText,
  };
});

vi.mock("$lib/server/llm/model-factory.js", () => ({
  createModel: vi.fn(() => ({})),
}));

vi.mock("$lib/server/llm/rate-limiter.js", () => ({
  throttleLLMCall: vi.fn(),
}));

vi.mock("$lib/server/logger.js", () => ({
  createLogger: () => ({ trace: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

import { extractStatementLines } from "./statement-llm.js";

function provider(name: string, model = name) {
  return {
    type: "groq",
    name,
    model,
    apiKey: "test-key",
  };
}

const validResult = {
  lines: [{ date: "2026-08-01", description: "Salary", amount: 2500 }],
};

beforeEach(() => {
  mocks.generateObject.mockReset();
  mocks.generateText.mockReset();
});

describe("extractStatementLines", () => {
  it("uses provider-native structured output", async () => {
    mocks.generateObject.mockResolvedValue({ object: validResult });

    await expect(
      extractStatementLines("readable statement text", [provider("primary")]),
    ).resolves.toEqual(validResult);
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("falls back to schema-validated text when structured output is unsupported", async () => {
    mocks.generateObject.mockRejectedValue(
      new APICallError({
        message: "response_format is unsupported",
        url: "https://provider.invalid",
        requestBodyValues: {},
        statusCode: 400,
      }),
    );
    mocks.generateText.mockResolvedValue({
      text: `Here is the result: ${JSON.stringify(validResult)}`,
    });

    await expect(
      extractStatementLines("readable statement text", [
        provider("fallback", "unsupported-model"),
      ]),
    ).resolves.toEqual(validResult);
  });

  it("tries the next provider when one returns malformed transactions", async () => {
    mocks.generateObject
      .mockRejectedValueOnce(new Error("schema validation failed"))
      .mockResolvedValueOnce({ object: validResult });

    await expect(
      extractStatementLines("readable statement text", [
        provider("bad"),
        provider("good"),
      ]),
    ).resolves.toEqual(validResult);
    expect(mocks.generateObject).toHaveBeenCalledTimes(2);
  });
});
