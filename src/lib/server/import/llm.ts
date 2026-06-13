import { createLogger } from '../logger.js';

export type LLMResult = {
	document_type: 'expense' | 'income';
	item_name: string;
	supplier: string;
	date: string;
	amount: number;
	reference: string;
	category: string;
	remark: string;
};

const log = createLogger('import:llm');

const JSON_SCHEMA = {
	type: 'object',
	properties: {
		document_type: { type: 'string', enum: ['expense', 'income'] },
		item_name: { type: 'string' },
		supplier: { type: 'string' },
		date: { type: 'string', description: 'YYYY-MM-DD' },
		amount: { type: 'number' },
		reference: { type: 'string' },
		category: { type: 'string' },
		remark: { type: 'string' }
	},
	required: ['document_type', 'item_name', 'supplier', 'date', 'amount', 'reference', 'category', 'remark']
};

export async function callLLM(
	text: string,
	expenseCategories: string[],
	incomeCategories: string[],
	apiKey: string,
	model: string
): Promise<LLMResult> {
	const today = new Date().toISOString().slice(0, 10);
	const prompt = `You are a bookkeeping assistant. Analyse the following document text and extract structured data.

Document text:
---
${text.slice(0, 6000)}
---

Instructions:
- Determine if this is an expense (money paid out) or income (money received). Set document_type accordingly.
- For expenses: item_name = what was purchased, supplier = who was paid, category = one of [${expenseCategories.join(', ')}]
- For income: item_name = income source/payer, supplier = description of what the income is for, category = one of [${incomeCategories.join(', ')}]
- date must be YYYY-MM-DD format. If unclear, use today (${today}).
- amount must be a positive number (no currency symbol).
- reference = invoice/receipt/transaction number if present, else empty string.
- remark = any useful notes, else empty string.
- If a field cannot be determined, use an empty string or 0 for amount.

Respond with valid JSON only, matching the schema exactly. No markdown, no extra text.`;

	for (let attempt = 0; attempt < 3; attempt++) {
		log.debug({ model, textLength: text.length, attempt }, 'Sending LLM request');
		try {
			// const reqHeaders = {
			// 	'Content-Type': 'application/json',
			// 	Authorization: `Bearer ${apiKey.slice(0, 8)}…`, // redact key; keep prefix for debugging
			// 	'HTTP-Referer': 'https://akaun.app',
			// 	'X-Title': 'Akaun Web'
			// };
			const reqHeaders = {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${apiKey}`
			};
			const reqBody = {
				model,
				messages: [{ role: 'user', content: prompt }],
				response_format: {
					type: 'json_schema',
					json_schema: { name: 'document_extraction', strict: true, schema: JSON_SCHEMA }
				},
				temperature: 0
			};
			log.trace({ attempt, reqHeaders, reqBody }, 'OpenRouter request');

			const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
				method: 'POST',
				headers: { ...reqHeaders, Authorization: `Bearer ${apiKey}` },
				body: JSON.stringify(reqBody)
			});

			const resHeaders = Object.fromEntries(res.headers.entries());
			const resBodyText = await res.text();
			log.trace({ attempt, status: res.status, resHeaders, resBody: resBodyText }, 'OpenRouter response');

			if (res.status === 401 || res.status === 403) {
				// Tag as fatal so the catch block does not retry
				const e = new Error(
					`OpenRouter authentication failed (${res.status}): ${resBodyText.slice(0, 200)}\n\nCheck your API key in Settings → Intelligence.`
				);
				(e as Error & { fatal?: boolean }).fatal = true;
				throw e;
			}

			if (res.status === 429 || res.status >= 500) {
				log.warn({ status: res.status, attempt }, 'OpenRouter rate limit or server error, retrying');
				await sleep(Math.pow(2, attempt) * 1000);
				continue;
			}

			if (!res.ok) {
				throw new Error(`OpenRouter error ${res.status}: ${resBodyText.slice(0, 200)}`);
			}

			const data = JSON.parse(resBodyText);
			const content = data.choices?.[0]?.message?.content;
			if (!content) throw new Error('Empty response from LLM');

			log.debug({ content: content.slice(0, 500) }, 'Raw LLM response');

			let parsed: LLMResult;
			try {
				parsed = JSON.parse(content) as LLMResult;
			} catch (parseErr) {
				log.error({ content: content.slice(0, 500), parseErr }, 'Failed to parse LLM JSON');
				throw new Error(`LLM returned invalid JSON: ${content.slice(0, 100)}`);
			}

			parsed.amount = parseAmount(parsed.amount);
			parsed.date = parseDate(parsed.date, today);
			log.debug({ documentType: parsed.document_type, amount: parsed.amount, date: parsed.date }, 'LLM extraction successful');
			return parsed;
		} catch (err) {
			if (attempt === 2 || (err as { fatal?: boolean }).fatal) throw err;
			await sleep(Math.pow(2, attempt) * 1000);
		}
	}
	throw new Error('LLM extraction failed after 3 attempts (rate limit or server error)');
}

function parseAmount(v: unknown): number {
	if (typeof v === 'number') return Math.abs(v);
	const s = String(v).replace(/[^0-9.]/g, '');
	const n = parseFloat(s);
	return isNaN(n) ? 0 : Math.abs(n);
}

function parseDate(v: unknown, fallback: string): string {
	const s = String(v ?? '');
	if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
	const d = new Date(s);
	if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
	return fallback;
}

function sleep(ms: number) {
	return new Promise((r) => setTimeout(r, ms));
}
