import {
  APICallError,
  NoObjectGeneratedError,
  generateObject,
  generateText,
} from "ai";
import type { LLMProviderConfig } from "$lib/server/llm/model-factory.js";
import { createModel } from "$lib/server/llm/model-factory.js";
import { throttleLLMCall } from "$lib/server/llm/rate-limiter.js";
import { withRetry } from "$lib/server/llm/retry.js";
import { createLogger } from "$lib/server/logger.js";
import { StatementLinesSchema } from "./statement-parse.js";

const log = createLogger("reconciliation:statement-llm");
const jsonSchemaUnsupportedModels = new Set<string>();

const SYSTEM_PROMPT = `You extract bank-statement transactions into JSON.
Return only one JSON object with a "lines" array. Each line must contain:
- date: YYYY-MM-DD; infer a missing year from the statement date printed elsewhere in the document
- description: transaction description
- amount: signed number (negative means money out)
- direction: "in" or "out" when the sign is not sufficient
You may include a balance field, but never turn opening/closing balances, running balances,
subtotals, or summary totals into transaction rows. Do not invent missing transactions.`;

function jsonObject(text: string): unknown {
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

function cacheKey(provider: LLMProviderConfig): string {
  return `${provider.type}:${provider.model}`;
}

async function extractWithProvider(
  text: string,
  provider: LLMProviderConfig,
  intervalMs: number,
) {
  const model = createModel(provider);
  const prompt = `Extract every transaction from this statement:\n\n${text}`;
  const key = cacheKey(provider);

  if (!jsonSchemaUnsupportedModels.has(key)) {
    try {
      await throttleLLMCall(intervalMs);
      log.trace(
        {
          provider: provider.name,
          type: provider.type,
          model: provider.model,
          mode: "structured",
          system: SYSTEM_PROMPT,
          prompt,
        },
        "Statement LLM request",
      );
      const { object } = await generateObject({
        model,
        schema: StatementLinesSchema,
        system: SYSTEM_PROMPT,
        prompt,
        temperature: 0,
      });
      log.trace(
        {
          provider: provider.name,
          type: provider.type,
          model: provider.model,
          mode: "structured",
          response: object,
        },
        "Statement LLM response",
      );
      return object;
    } catch (error) {
      const unsupported =
        APICallError.isInstance(error) && error.statusCode === 400;
      const invalidObject = NoObjectGeneratedError.isInstance(error);
      if (!unsupported && !invalidObject) throw error;
      if (invalidObject) {
        log.trace(
          {
            provider: provider.name,
            type: provider.type,
            model: provider.model,
            mode: "structured",
            response: error.text,
            finishReason: error.finishReason,
            responseMetadata: error.response,
          },
          "Statement LLM invalid structured response",
        );
      }
      jsonSchemaUnsupportedModels.add(key);
      log.info(
        {
          provider: provider.name,
          type: provider.type,
          model: provider.model,
          reason: unsupported ? "unsupported" : "invalid-object",
        },
        "Structured output unavailable; falling back to text mode",
      );
    }
  }

  await throttleLLMCall(intervalMs);
  log.trace(
    {
      provider: provider.name,
      type: provider.type,
      model: provider.model,
      mode: "text",
      system: SYSTEM_PROMPT,
      prompt,
    },
    "Statement LLM request",
  );
  const result = await generateText({
    model,
    system: SYSTEM_PROMPT,
    prompt,
    temperature: 0,
  });
  log.trace(
    {
      provider: provider.name,
      type: provider.type,
      model: provider.model,
      mode: "text",
      response: result.text,
    },
    "Statement LLM response",
  );
  return StatementLinesSchema.parse(jsonObject(result.text));
}

export async function extractStatementLines(
  text: string,
  providers: LLMProviderConfig[],
  intervalMs = 0,
) {
  let lastError: unknown;
  for (const provider of providers) {
    try {
      log.info(
        { provider: provider.name, type: provider.type, model: provider.model },
        "Trying statement extraction provider",
      );
      const result = await withRetry(() =>
        extractWithProvider(text, provider, intervalMs),
      );
      log.info(
        {
          provider: provider.name,
          type: provider.type,
          model: provider.model,
          extractedRows: result.lines.length,
        },
        "Statement extraction succeeded",
      );
      return result;
    } catch (error) {
      lastError = error;
      log.warn(
        {
          provider: provider.name,
          type: provider.type,
          model: provider.model,
          statusCode: APICallError.isInstance(error)
            ? error.statusCode
            : undefined,
          errorType: error instanceof Error ? error.name : typeof error,
        },
        "Statement extraction provider failed",
      );
    }
  }
  if (lastError) {
    throw new Error(
      "All document extraction providers failed to return valid transactions",
      {
        cause: lastError,
      },
    );
  }
  throw new Error("No document extraction provider is configured");
}
