import type { LLMProviderConfig } from "$lib/server/llm/model-factory.js";
import {
  callStructured,
  withProviderFailover,
} from "$lib/server/llm/structured-call.js";
import { createLogger } from "$lib/server/logger.js";
import { StatementLinesSchema } from "./statement-parse.js";

const log = createLogger("reconciliation:statement-llm");

const SYSTEM_PROMPT = `You extract bank-statement transactions into JSON.
Return only one JSON object with a "lines" array. Each line must contain:
- date: YYYY-MM-DD; infer a missing year from the statement date printed elsewhere in the document
- description: transaction description
- amount: signed number (negative means money out)
- direction: "in" or "out" when the sign is not sufficient
You may include a balance field, but never turn opening/closing balances, running balances,
subtotals, or summary totals into transaction rows. Do not invent missing transactions.`;

// Reads every transaction line from a bank statement. The prompt lives here and
// the schema in statement-parse.ts; the call itself, its text fallback and the
// provider failover are the shared ones in llm/structured-call.ts.
export async function extractStatementLines(
  text: string,
  providers: LLMProviderConfig[],
  intervalMs = 0,
) {
  const spec = {
    schemaId: "statement@1",
    schema: StatementLinesSchema,
    parse: (raw: unknown) => StatementLinesSchema.parse(raw),
    instructions: SYSTEM_PROMPT,
    prompt: `Extract every transaction from this statement:\n\n${text}`,
  };

  return withProviderFailover(
    providers,
    async (model, provider) => {
      const result = await callStructured(model, provider, spec, intervalMs);
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
    },
    log,
    "All document extraction providers failed to return valid transactions",
  );
}
