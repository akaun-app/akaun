import { generateText } from 'ai';
import type { LLMProviderConfig } from '$lib/server/llm/model-factory.js';
import { createModel } from '$lib/server/llm/model-factory.js';
import { throttleLLMCall } from '$lib/server/llm/rate-limiter.js';
import { withRetry } from '$lib/server/llm/retry.js';
import { StatementLinesSchema } from './statement-parse.js';

const SYSTEM_PROMPT = `You extract bank-statement transactions into JSON.
Return only one JSON object with a "lines" array. Each line must contain:
- date: the transaction date as printed
- description: transaction description
- amount: signed number (negative means money out)
- direction: "in" or "out" when the sign is not sufficient
You may include a balance field, but never turn opening/closing balances, running balances,
subtotals, or summary totals into transaction rows. Do not invent missing transactions.`;

function jsonObject(text: string): unknown {
	const start = text.indexOf('{');
	if (start < 0) throw new Error('The extraction provider returned no JSON object');
	let depth = 0;
	let quoted = false;
	let escaped = false;
	for (let index = start; index < text.length; index++) {
		const char = text[index];
		if (quoted) {
			if (escaped) escaped = false;
			else if (char === '\\') escaped = true;
			else if (char === '"') quoted = false;
			continue;
		}
		if (char === '"') quoted = true;
		else if (char === '{') depth++;
		else if (char === '}' && --depth === 0) return JSON.parse(text.slice(start, index + 1));
	}
	throw new Error('The extraction provider returned incomplete JSON');
}

export async function extractStatementLines(
	text: string,
	providers: LLMProviderConfig[],
	intervalMs = 0
) {
	let lastError: unknown;
	for (const provider of providers) {
		try {
			const model = createModel(provider);
			const result = await withRetry(async () => {
				await throttleLLMCall(intervalMs);
				return generateText({
					model,
					system: SYSTEM_PROMPT,
					prompt: `Extract every transaction from this statement:\n\n${text}`,
					temperature: 0
				});
			});
			return StatementLinesSchema.parse(jsonObject(result.text));
		} catch (error) {
			lastError = error;
		}
	}
	throw lastError ?? new Error('No document extraction provider is configured');
}
