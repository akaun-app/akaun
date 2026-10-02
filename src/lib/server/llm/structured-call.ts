// One structured LLM call, and the provider failover around it, shared by
// every feature that asks a model for JSON (auto-import's receipt reading,
// reconciliation's statement lines). Each feature keeps its own prompt, schema
// and post-processing; this module only decides how the call is made.
//
// A call first asks the provider for output that matches a JSON schema. When
// the provider refuses the schema, or the model's answer does not fit it, the
// same prompt is sent again without a schema and the JSON is cut out of the
// reply text. The prompts already ask for JSON only, so every provider can
// answer that way.

import {
  APICallError,
  NoObjectGeneratedError,
  Output,
  RetryError,
  generateText,
} from "ai";
import type { FlexibleSchema, LanguageModel } from "ai";
import { createLogger } from "../logger.js";
import { createModel, type LLMProviderConfig } from "./model-factory.js";
import { throttleLLMCall } from "./rate-limiter.js";

type Logger = ReturnType<typeof createLogger>;

const log = createLogger("llm:structured-call");

// What one feature asks of the model.
export interface StructuredSpec<T> {
  // Names the schema, with a version, for the unsupported cache below — for
  // example 'receipt@1'. Change the version when the schema changes, so a
  // provider that rejected the old schema is given the new one again.
  schemaId: string;
  // The schema sent to the provider for structured output.
  schema: FlexibleSchema<T>;
  // Checks a value read from reply text, on the text fallback. Throws when the
  // value does not fit.
  parse: (raw: unknown) => T;
  instructions: string;
  prompt: string;
  maxOutputTokens?: number;
  // The longest one request may take, in milliseconds. When it runs out, the
  // request is stopped and `CallTimedOutError` is thrown. Without it a request
  // waits until the runtime's own fetch timeout (300 s under Bun), whose error
  // names no limit.
  timeoutMs?: number;
  // When true, a provider that refuses the schema (HTTP 400) fails the call
  // with `SchemaRejectedError` instead of being asked again without a schema,
  // and the refusal is not remembered: the next call with this schema asks for
  // structured output again. Used for a schema the user wrote the rules of (an
  // import profile, 006 FR-037), where an answer without the schema could hold
  // lines the schema exists to keep out. An answer that does not fit the
  // schema is still read from text, because some models wrap correct JSON in a
  // markdown fence (design.md, "S0.5 research results").
  schemaRequired?: boolean;
  // Called with the tokens each request used, as the provider reported them,
  // as soon as its answer arrives: an answer cut off at the output limit
  // reports too, before `OutputTruncatedError` is thrown, and a call that is
  // asked again in text mode reports once for each request. A caller that
  // reads a document in pieces uses it to size the next piece by how much the
  // model actually wrote (006 FR-043). A count the provider did not report is
  // undefined.
  onUsage?: (usage: CallUsage) => void;
}

// The tokens one request used.
export interface CallUsage {
  inputTokens: number | undefined;
  outputTokens: number | undefined;
}

// Passes a request's token counts to the spec's `onUsage`, when it has one.
function reportUsage<T>(
  spec: StructuredSpec<T>,
  usage: Partial<CallUsage> | undefined,
): void {
  spec.onUsage?.({
    inputTokens: usage?.inputTokens,
    outputTokens: usage?.outputTokens,
  });
}

// The model stopped before its answer was complete — usually because it hit
// the output length limit. A caller that reads a document in pieces can catch
// this and try again with a smaller piece. It is never retried in text mode,
// because the same prompt would be cut off the same way.
export class OutputTruncatedError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("The model stopped before its answer was complete", options);
    this.name = "OutputTruncatedError";
  }
}

// A request took longer than the spec's `timeoutMs` and was stopped. Like a
// cut-off answer, it is never retried in text mode: the same prompt would take
// as long again.
export class CallTimedOutError extends Error {
  constructor(
    readonly timeoutMs: number,
    options?: { cause?: unknown },
  ) {
    super(`The model did not answer within ${timeoutMs} ms`, options);
    this.name = "CallTimedOutError";
  }
}

// The provider refused a request whose schema the spec says is required (HTTP
// 400). A 400 does not always mean the schema was the problem (a bad API key
// on Google is a 400 too), so the message names the status and quotes the
// provider's own reason rather than blaming the schema.
export class SchemaRejectedError extends Error {
  constructor(
    readonly schemaId: string,
    readonly providerMessage: string,
    options?: { cause?: unknown },
  ) {
    super(
      `The AI provider refused the request (HTTP 400): ${providerMessage}`,
      options,
    );
    this.name = "SchemaRejectedError";
  }
}

// Sends one request, stopped after `timeoutMs` when it is given. A failure
// after that limit ran out is reported as `CallTimedOutError`, whatever error
// the SDK or fetch raised for the stopped request.
async function within<R>(
  timeoutMs: number | undefined,
  send: (abortSignal: AbortSignal | undefined) => Promise<R>,
): Promise<R> {
  const signal = timeoutMs != null ? AbortSignal.timeout(timeoutMs) : undefined;
  try {
    return await send(signal);
  } catch (error) {
    if (timeoutMs != null && signal?.aborted) {
      throw new CallTimedOutError(timeoutMs, { cause: error });
    }
    throw error;
  }
}

// Provider, model and schema combinations that answered a structured request
// with HTTP 400, which means the provider does not accept that schema (or any
// schema) for that model. Keyed "type:model:schemaId", so a model that rejects
// one schema is still asked for structured output with another. It is kept in
// memory and resets on server restart; the cost is one failed request per
// combination.
const structuredUnsupported = new Set<string>();

function cacheKey(provider: LLMProviderConfig, schemaId: string): string {
  return `${provider.type}:${provider.model}:${schemaId}`;
}

// True when the provider refused the request itself (HTTP 400). The SDK retries
// some errors on its own and then wraps the last one in a RetryError, so a 400
// that came after a retried 429 arrives wrapped.
function isRejectedRequest(error: unknown): boolean {
  return rejectedRequest(error) !== null;
}

function rejectedRequest(error: unknown): APICallError | null {
  const cause = RetryError.isInstance(error) ? error.lastError : error;
  return APICallError.isInstance(cause) && cause.statusCode === 400
    ? cause
    : null;
}

// Cuts the first complete JSON object out of a model's reply text and parses
// it. Models often add a sentence before or after the JSON, and that sentence
// may itself contain braces, so this counts braces from the first "{" and skips
// braces that are inside a quoted string.
export function extractJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  if (start < 0)
    throw new Error("The extraction provider returned no JSON object");
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0)
      return JSON.parse(text.slice(start, index + 1));
  }
  throw new Error("The extraction provider returned incomplete JSON");
}

// Makes one call to one model and returns a value that fits the spec. The rate
// limit is applied before every request, including the text retry.
export async function callStructured<T>(
  model: LanguageModel,
  provider: LLMProviderConfig,
  spec: StructuredSpec<T>,
  intervalMs = 0,
): Promise<T> {
  const who = {
    provider: provider.name,
    type: provider.type,
    model: provider.model,
    schemaId: spec.schemaId,
  };
  const key = cacheKey(provider, spec.schemaId);

  if (spec.schemaRequired || !structuredUnsupported.has(key)) {
    try {
      await throttleLLMCall(intervalMs);
      log.trace(
        {
          ...who,
          mode: "structured",
          instructions: spec.instructions,
          prompt: spec.prompt,
        },
        "LLM request",
      );
      const result = await within(spec.timeoutMs, (abortSignal) =>
        generateText({
          model,
          output: Output.object({ schema: spec.schema }),
          instructions: spec.instructions,
          prompt: spec.prompt,
          temperature: 0,
          maxOutputTokens: spec.maxOutputTokens,
          abortSignal,
        }),
      );
      reportUsage(spec, result.usage);
      // The SDK reads the answer only when the model finished normally, and
      // otherwise throws NoOutputGeneratedError when `output` is read. So the
      // reason the model stopped is checked first: only running out of output
      // length means the answer was cut off. Any other reason (a content
      // filter, or a provider that reports "other") says nothing about length,
      // so this call is tried again in text mode below.
      if (result.finishReason === "length") throw new OutputTruncatedError();
      if (result.finishReason === "stop") {
        const output = result.output;
        log.trace(
          { ...who, mode: "structured", response: output },
          "LLM response",
        );
        return output;
      }
      log.trace(
        { ...who, mode: "structured", response: result.text },
        "LLM unfinished structured response",
      );
      log.info(
        { ...who, reason: "unfinished", finishReason: result.finishReason },
        "Structured answer did not finish normally; retrying this call in text mode",
      );
    } catch (error) {
      if (
        error instanceof OutputTruncatedError ||
        error instanceof CallTimedOutError
      )
        throw error;
      if (isRejectedRequest(error) && spec.schemaRequired) {
        const rejected = rejectedRequest(error);
        log.info(
          { ...who, reason: "unsupported", schemaRequired: true },
          "Structured output rejected (400) for a required schema; failing this call",
        );
        throw new SchemaRejectedError(
          spec.schemaId,
          rejected?.message || "HTTP 400",
          { cause: error },
        );
      }
      if (isRejectedRequest(error)) {
        structuredUnsupported.add(key);
        log.info(
          { ...who, reason: "unsupported" },
          "Structured output rejected (400); using text mode for this model and schema",
        );
      } else if (NoObjectGeneratedError.isInstance(error)) {
        // The answer arrived, but did not fit; its tokens were still used.
        reportUsage(spec, error.usage);
        // One answer that did not fit says nothing about the next one, so the
        // model is not moved to text mode for later calls. The reply holds
        // the document's contents, so it goes to trace only, never info.
        log.trace(
          { ...who, mode: "structured", response: error.text },
          "LLM invalid structured response",
        );
        log.info(
          {
            ...who,
            reason: "invalid-object",
            finishReason: error.finishReason,
          },
          "Structured answer did not fit the schema; retrying this call in text mode",
        );
      } else {
        throw error;
      }
    }
  }

  await throttleLLMCall(intervalMs);
  log.trace(
    {
      ...who,
      mode: "text",
      instructions: spec.instructions,
      prompt: spec.prompt,
    },
    "LLM request",
  );
  const result = await within(spec.timeoutMs, (abortSignal) =>
    generateText({
      model,
      instructions: spec.instructions,
      prompt: spec.prompt,
      temperature: 0,
      maxOutputTokens: spec.maxOutputTokens,
      abortSignal,
    }),
  );
  reportUsage(spec, result.usage);
  log.trace({ ...who, mode: "text", response: result.text }, "LLM response");
  if (result.finishReason === "length") throw new OutputTruncatedError();
  return spec.parse(extractJsonObject(result.text));
}

// Runs `run` against each provider in order until one succeeds. `run` gets a
// fresh model for its provider and may make several calls; when any of them
// fails, the whole run starts again on the next provider, so a result never
// mixes answers from two providers.
//
// When every provider fails, the error thrown carries the last provider's
// error as its `cause`. Its message is `failureMessage` when given, otherwise
// the last error's own message, so a caller that shows the message to the user
// still shows what went wrong.
export async function withProviderFailover<T>(
  providers: LLMProviderConfig[],
  run: (model: LanguageModel, provider: LLMProviderConfig) => Promise<T>,
  logger: Logger,
  failureMessage?: string,
): Promise<T> {
  if (providers.length === 0) throw new Error("No LLM provider is configured");

  let lastError: unknown;
  for (const provider of providers) {
    const who = {
      provider: provider.name,
      type: provider.type,
      model: provider.model,
    };
    try {
      logger.info(who, "Trying provider");
      return await run(createModel(provider), provider);
    } catch (error) {
      lastError = error;
      logger.warn(
        {
          ...who,
          errorMessage: error instanceof Error ? error.message : String(error),
          statusCode: APICallError.isInstance(error)
            ? error.statusCode
            : undefined,
          errorType: error instanceof Error ? error.name : typeof error,
        },
        "Provider failed, skipping to next",
      );
    }
  }

  const lastMessage =
    lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(failureMessage ?? lastMessage, { cause: lastError });
}
