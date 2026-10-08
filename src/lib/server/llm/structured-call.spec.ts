import { beforeEach, describe, expect, it, vi } from "vitest";
import { RetryError } from "ai";
import { z } from "zod";
import {
  askedForSchema,
  httpError,
  mockModel,
  provider,
} from "./__fixtures__/mock-model.js";

const mocks = vi.hoisted(() => ({
  models: new Map<string, unknown>(),
  throttle: vi.fn(async () => {}),
}));

vi.mock("$lib/server/llm/model-factory.js", () => ({
  createModel: vi.fn((config: { name: string }) => {
    const model = mocks.models.get(config.name);
    if (!model) throw new Error(`No mock model for ${config.name}`);
    return model;
  }),
}));

vi.mock("$lib/server/llm/rate-limiter.js", () => ({
  throttleLLMCall: mocks.throttle,
}));

const silentLog = vi.hoisted(() => ({
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}));

vi.mock("$lib/server/logger.js", () => ({
  createLogger: () => silentLog,
}));

import {
  CallTimedOutError,
  OutputTruncatedError,
  SchemaRejectedError,
  callStructured,
  extractJsonObject,
  withProviderFailover,
  type StructuredSpec,
} from "./structured-call.js";

const Thing = z.object({ name: z.string(), count: z.number() });
type Thing = z.infer<typeof Thing>;

function spec(schemaId: string): StructuredSpec<Thing> {
  return {
    schemaId,
    schema: Thing,
    parse: (raw) => Thing.parse(raw),
    instructions: "Reply with a thing as JSON.",
    prompt: "<document>one apple</document>",
  };
}

const thing = { name: "apple", count: 1 };
const log = silentLog as unknown as Parameters<typeof withProviderFailover>[2];

beforeEach(() => {
  mocks.models.clear();
  mocks.throttle.mockClear();
});

describe("callStructured", () => {
  it("returns the structured answer from one schema request", async () => {
    const model = mockModel([{ text: JSON.stringify(thing) }]);

    await expect(
      callStructured(model, provider("ok"), spec("thing@1"), 250),
    ).resolves.toEqual(thing);
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(askedForSchema(model, 0)).toBe(true);
    expect(model.doGenerateCalls[0].temperature).toBe(0);
    expect(model.doGenerateCalls[0].prompt[0]).toMatchObject({
      role: "system",
      content: "Reply with a thing as JSON.",
    });
    expect(mocks.throttle).toHaveBeenCalledTimes(1);
    expect(mocks.throttle).toHaveBeenCalledWith(250);
  });

  it("sends no temperature to a ChatGPT plan, in either mode", async () => {
    const model = mockModel([
      { error: httpError(400, "response_format is unsupported") },
      { text: JSON.stringify(thing) },
    ]);
    const config = { ...provider("plan", "gpt-5.6-luna"), type: "chatgpt" };

    await expect(
      callStructured(model, config, spec("thing@1")),
    ).resolves.toEqual(thing);
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(model.doGenerateCalls[0].temperature).toBeUndefined();
    expect(model.doGenerateCalls[1].temperature).toBeUndefined();
  });

  it("falls back to text on a 400 and remembers it for that schema only", async () => {
    const model = mockModel([
      { error: httpError(400, "response_format is unsupported") },
      { text: `Sure: ${JSON.stringify(thing)}` },
      { text: JSON.stringify(thing) },
    ]);
    const config = provider("strict", "strict-model");

    await expect(
      callStructured(model, config, spec("thing@1"), 250),
    ).resolves.toEqual(thing);
    expect(askedForSchema(model, 0)).toBe(true);
    expect(askedForSchema(model, 1)).toBe(false);
    // The rate limit applies to the text retry too.
    expect(mocks.throttle).toHaveBeenCalledTimes(2);

    // Same model and schema: straight to text.
    await callStructured(model, config, spec("thing@1"));
    expect(model.doGenerateCalls).toHaveLength(3);
    expect(askedForSchema(model, 2)).toBe(false);

    // Same model, another schema: structured output is still tried.
    await callStructured(model, config, spec("other@1"));
    expect(model.doGenerateCalls).toHaveLength(4);
    expect(askedForSchema(model, 3)).toBe(true);
  });

  it("fails a call whose schema is required on a 400, with no text retry and nothing remembered", async () => {
    const model = mockModel([
      { error: httpError(400, "enum too large") },
      { text: JSON.stringify(thing) },
    ]);
    const config = provider("picky", "picky-model");
    const lenient = spec("profile:7:abc");
    const required = { ...spec("profile:7:abc"), schemaRequired: true };

    const failure = await callStructured(model, config, required).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(SchemaRejectedError);
    expect((failure as SchemaRejectedError).providerMessage).toBe(
      "enum too large",
    );
    expect(model.doGenerateCalls).toHaveLength(1);

    // The refusal is not remembered: the same schema is asked for again, and
    // so is any other schema on the same model.
    await expect(callStructured(model, config, required)).resolves.toEqual(
      thing,
    );
    expect(askedForSchema(model, 1)).toBe(true);
    await callStructured(model, config, spec("builtin:items@1"));
    expect(askedForSchema(model, 2)).toBe(true);
    // The direct proof: a call for the same schema that may fall back still
    // asks for it, which it would not if the refusal had been cached.
    await callStructured(model, config, lenient);
    expect(askedForSchema(model, 3)).toBe(true);
  });

  it("still reads a required schema's answer from text when it did not fit", async () => {
    const fenced = "```json\n" + JSON.stringify(thing) + "\n```";
    const model = mockModel([{ text: fenced }, { text: fenced }]);
    const required = { ...spec("profile:7:abc"), schemaRequired: true };

    await expect(
      callStructured(model, provider("fence"), required),
    ).resolves.toEqual(thing);
    expect(askedForSchema(model, 0)).toBe(true);
    expect(askedForSchema(model, 1)).toBe(false);
  });

  it("treats a 400 wrapped in the SDK's RetryError as a rejected schema", async () => {
    const wrapped = new RetryError({
      message: "Failed after 3 attempts",
      reason: "errorNotRetryable",
      errors: [httpError(429), httpError(400, "schema rejected")],
    });
    const model = mockModel([
      { error: wrapped },
      { text: JSON.stringify(thing) },
    ]);
    const config = provider("retried", "retried-model");

    await expect(
      callStructured(model, config, spec("thing@1")),
    ).resolves.toEqual(thing);
    expect(askedForSchema(model, 1)).toBe(false);

    await callStructured(model, config, spec("thing@1"));
    expect(model.doGenerateCalls).toHaveLength(3);
    expect(askedForSchema(model, 2)).toBe(false);
  });

  it("retries one call in text when the answer does not fit, without remembering it", async () => {
    const model = mockModel([
      { text: JSON.stringify({ name: "apple" }) },
      { text: JSON.stringify(thing) },
    ]);
    const config = provider("sloppy", "sloppy-model");

    await expect(
      callStructured(model, config, spec("thing@1")),
    ).resolves.toEqual(thing);
    expect(askedForSchema(model, 0)).toBe(true);
    expect(askedForSchema(model, 1)).toBe(false);

    // The next call asks for structured output again.
    await callStructured(model, config, spec("thing@1"));
    expect(askedForSchema(model, 2)).toBe(true);
  });

  it("reports a cut-off structured answer as truncated, with no text retry", async () => {
    const model = mockModel([{ truncated: '{"name": "app' }]);

    await expect(
      callStructured(model, provider("long"), spec("thing@1")),
    ).rejects.toBeInstanceOf(OutputTruncatedError);
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it("retries in text mode when the structured answer ended for another reason", async () => {
    // A content filter or a provider's "other" is not a length limit, so it is
    // not reported as truncated; the same call is made again without a schema.
    const model = mockModel([
      { text: JSON.stringify(thing), finishReason: "other" },
      { text: JSON.stringify(thing) },
    ]);
    const config = provider("other-reason");

    await expect(
      callStructured(model, config, spec("thing@1")),
    ).resolves.toEqual(thing);
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(askedForSchema(model, 1)).toBe(false);

    // It is not remembered: the next call asks for a schema again.
    await callStructured(model, config, spec("thing@1"));
    expect(askedForSchema(model, 2)).toBe(true);
  });

  it("reports a cut-off text answer as truncated", async () => {
    const model = mockModel([
      { error: httpError(400) },
      { truncated: '{"name": "app' },
    ]);

    await expect(
      callStructured(model, provider("longtext"), spec("thing@1")),
    ).rejects.toBeInstanceOf(OutputTruncatedError);
  });

  it("throws other provider errors without a text retry", async () => {
    const model = mockModel([{ error: httpError(401, "Invalid API key") }]);

    await expect(
      callStructured(model, provider("denied"), spec("thing@1")),
    ).rejects.toThrow("Invalid API key");
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it("stops a request that runs past the time limit, with no text retry", async () => {
    const model = mockModel([{ hang: true }]);

    const failure = callStructured(model, provider("slow"), {
      ...spec("thing@1"),
      timeoutMs: 20,
    });

    await expect(failure).rejects.toBeInstanceOf(CallTimedOutError);
    await expect(failure).rejects.toMatchObject({ timeoutMs: 20 });
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it("stops the text retry too when it runs past the time limit", async () => {
    const model = mockModel([{ error: httpError(400) }, { hang: true }]);

    await expect(
      callStructured(model, provider("slowtext"), {
        ...spec("thing@1"),
        timeoutMs: 20,
      }),
    ).rejects.toBeInstanceOf(CallTimedOutError);
    expect(model.doGenerateCalls).toHaveLength(2);
  });

  it("sends the output length cap with every request", async () => {
    const model = mockModel([
      { error: httpError(400) },
      { text: JSON.stringify(thing) },
    ]);

    await callStructured(model, provider("capped"), {
      ...spec("thing@1"),
      maxOutputTokens: 512,
    });

    expect(model.doGenerateCalls.map((call) => call.maxOutputTokens)).toEqual([
      512, 512,
    ]);
  });

  it("reports the tokens each request used, the text retry and a cut-off answer too", async () => {
    const usage = vi.fn();
    const fits = mockModel([{ text: JSON.stringify(thing) }]);
    await callStructured(fits, provider("counted"), {
      ...spec("thing@1"),
      onUsage: usage,
    });
    expect(usage.mock.calls).toEqual([[{ inputTokens: 10, outputTokens: 10 }]]);

    usage.mockClear();
    const retried = mockModel([
      { text: JSON.stringify({ name: "apple" }) },
      { text: JSON.stringify(thing) },
    ]);
    await callStructured(retried, provider("counted-retry"), {
      ...spec("thing@1"),
      onUsage: usage,
    });
    expect(usage).toHaveBeenCalledTimes(2);

    usage.mockClear();
    const cut = mockModel([{ truncated: '{"name": "app' }]);
    await expect(
      callStructured(cut, provider("counted-cut"), {
        ...spec("thing@1"),
        onUsage: usage,
      }),
    ).rejects.toBeInstanceOf(OutputTruncatedError);
    expect(usage).toHaveBeenCalledTimes(1);
  });

  it("throws when the text answer does not fit the schema", async () => {
    const model = mockModel([
      { error: httpError(400) },
      { text: JSON.stringify({ name: 3 }) },
    ]);

    await expect(
      callStructured(model, provider("badtext"), spec("thing@1")),
    ).rejects.toThrow();
  });
});

describe("withProviderFailover", () => {
  it("runs the whole closure again on the next provider", async () => {
    mocks.models.set("first", mockModel([{ error: httpError(401) }]));
    mocks.models.set("second", mockModel([{ text: JSON.stringify(thing) }]));
    const tried: string[] = [];

    const result = await withProviderFailover(
      [provider("first"), provider("second")],
      async (model, config) => {
        tried.push(config.name);
        return callStructured(model, config, spec("thing@1"));
      },
      log,
    );

    expect(result).toEqual(thing);
    expect(tried).toEqual(["first", "second"]);
  });

  it("throws the last error as the cause, keeping its message by default", async () => {
    const lastError = new Error("Quota exhausted");
    mocks.models.set("a", mockModel([{ text: "{}" }]));
    mocks.models.set("b", mockModel([{ text: "{}" }]));

    const failure = await withProviderFailover(
      [provider("a"), provider("b")],
      async (_model, config) => {
        throw config.name === "a" ? new Error("Invalid API key") : lastError;
      },
      log,
    ).catch((error: unknown) => error as Error);

    expect(failure.message).toBe("Quota exhausted");
    expect(failure.cause).toBe(lastError);
  });

  it("uses the caller's failure message when given", async () => {
    mocks.models.set("a", mockModel([{ text: "{}" }]));
    await expect(
      withProviderFailover(
        [provider("a")],
        async () => {
          throw new Error("boom");
        },
        log,
        "Nothing worked",
      ),
    ).rejects.toThrow("Nothing worked");
  });

  it("refuses an empty provider list", async () => {
    await expect(
      withProviderFailover([], async () => thing, log),
    ).rejects.toThrow("No LLM provider is configured");
  });
});

describe("extractJsonObject", () => {
  it("ignores prose around the object", () => {
    expect(
      extractJsonObject('Here it is: {"a": 1} Let me know {if} needed.'),
    ).toEqual({ a: 1 });
  });

  it("does not count braces inside strings", () => {
    expect(
      extractJsonObject('{"note": "use } and { freely", "n": {"x": 2}} tail }'),
    ).toEqual({ note: "use } and { freely", n: { x: 2 } });
  });

  it("handles escaped quotes inside strings", () => {
    expect(extractJsonObject('{"say": "a \\"}\\" b"} done')).toEqual({
      say: 'a "}" b',
    });
  });

  it("throws when there is no object", () => {
    expect(() => extractJsonObject("no json here")).toThrow("no JSON object");
  });

  it("throws when the object never closes", () => {
    expect(() => extractJsonObject('{"a": {"b": 1}')).toThrow(
      "incomplete JSON",
    );
  });
});
