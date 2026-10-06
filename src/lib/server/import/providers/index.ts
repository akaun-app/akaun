import { createLogger } from "../../logger.js";
import {
  LLMResultSchema,
  buildSystemPrompt,
  buildUserPrompt,
  postProcess,
} from "./shared.js";
import type { LLMCallParams, LLMResult } from "./types.js";
import type { LLMProviderConfig } from "../../llm/model-factory.js";
import {
  callStructured,
  withProviderFailover,
} from "../../llm/structured-call.js";

export type { LLMResult, LLMCallParams, ProviderType } from "./types.js";
export type { ModelInfo } from "./types.js";

const log = createLogger("import:llm");

// Reads one receipt or invoice into one record. The prompt, schema and clean-up
// live in shared.ts; the call itself, its text fallback and the provider
// failover are the shared ones in llm/structured-call.ts.
export async function callLLMWithProviders(
  params: LLMCallParams,
  configs: LLMProviderConfig[],
  intervalMs = 0,
): Promise<LLMResult> {
  const today = new Date().toISOString().slice(0, 10);
  const spec = {
    schemaId: "receipt@1",
    schema: LLMResultSchema,
    parse: (raw: unknown) => LLMResultSchema.parse(raw),
    instructions: buildSystemPrompt({ ...params, today }),
    prompt: buildUserPrompt(params),
  };

  const object = await withProviderFailover(
    configs,
    (model, config) => callStructured(model, config, spec, intervalMs),
    log,
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
}
