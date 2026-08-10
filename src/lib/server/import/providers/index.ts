import { generateObject, generateText, APICallError } from "ai";
import type { LanguageModel } from "ai";
import { createLogger } from "../../logger.js";
import {
  LLMResultSchema,
  buildSystemPrompt,
  buildUserPrompt,
  postProcess,
} from "./shared.js";
import type { LLMCallParams, LLMResult } from "./types.js";
import { throttleLLMCall } from "../../llm/rate-limiter.js";
import { createModel, type LLMProviderConfig } from "../../llm/model-factory.js";
import { withRetry } from "../../llm/retry.js";

export type { LLMResult, LLMCallParams, ProviderType } from "./types.js";
export type { ModelInfo } from "./types.js";

const log = createLogger("import:llm");

type ProviderConfig = LLMProviderConfig;

// Models confirmed at runtime not to support json_schema. Keyed "type:model".
// Resets on server restart; warm-up cost is one failed attempt per unsupported model.
const jsonSchemaUnsupportedModels = new Set<string>();

function cacheKey(config: ProviderConfig): string {
  return `${config.type}:${config.model}`;
}

async function callWithStructuredFallback(
  model: LanguageModel,
  config: ProviderConfig,
  params: LLMCallParams,
  today: string,
  intervalMs: number,
): Promise<LLMResult> {
  await throttleLLMCall(intervalMs);

  const system = buildSystemPrompt({ ...params, today });
  const prompt = buildUserPrompt(params);
  const key = cacheKey(config);

  if (!jsonSchemaUnsupportedModels.has(key)) {
    try {
      const { object } = await generateObject({
        model,
        schema: LLMResultSchema,
        system,
        prompt,
        temperature: 0,
      });
      return object;
    } catch (err) {
      if (APICallError.isInstance(err) && err.statusCode === 400) {
        log.info(
          { model: config.model, provider: config.type },
          "Structured output rejected (400) — falling back to text mode",
        );
        jsonSchemaUnsupportedModels.add(key);
        // fall through to text fallback below
      } else {
        throw err;
      }
    }
  }

  // Text fallback: no response_format sent — works universally across all providers.
  // System prompt instructs "Respond with valid JSON only" so models comply.
  const { text } = await generateText({ model, system, prompt, temperature: 0 });
  log.debug({ textPreview: text.slice(0, 200) }, "Text fallback raw response");
  return LLMResultSchema.parse(JSON.parse(extractJsonFromText(text)));
}

function extractJsonFromText(text: string): string {
  // Walk from the first '{' tracking brace depth to find the matching '}'.
  // Using depth-tracking instead of lastIndexOf avoids false positives when
  // the LLM appends trailing prose that contains its own '}' characters.
  const start = text.indexOf("{");
  if (start === -1) {
    throw new Error(`No JSON object found in LLM text response: ${text.slice(0, 200)}`);
  }
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  throw new Error(`Unclosed JSON object in LLM text response: ${text.slice(0, 200)}`);
}

function isAuthError(message: string): boolean {
  return /\b(401|403|unauthorized|forbidden|invalid.?api.?key|authentication)\b/i.test(
    message,
  );
}

export async function callLLMWithProviders(
  params: LLMCallParams,
  configs: ProviderConfig[],
  intervalMs = 0,
): Promise<LLMResult> {
  let lastError: unknown;
  const today = new Date().toISOString().slice(0, 10);

  for (const config of configs) {
    try {
      log.info(
        { provider: config.name, type: config.type, model: config.model },
        "Trying provider",
      );

      const model = createModel(config);
      const object = await withRetry(() =>
        callWithStructuredFallback(model, config, params, today, intervalMs),
      );

      const result = postProcess(object, today, params.mainCurrency);
      log.debug(
        {
          documentType: result.document_type,
          amount: result.amount,
          date: result.date,
        },
        "Extraction successful",
      );
      return result;
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const statusCode = APICallError.isInstance(err) ? err.statusCode : undefined;
      const isFatal = isAuthError(msg);
      log.warn(
        { provider: config.name, msg, statusCode, isFatal },
        isFatal
          ? "Provider auth failed, skipping to next"
          : "Provider failed, skipping to next",
      );
    }
  }

  throw lastError ?? new Error("All LLM providers failed");
}
