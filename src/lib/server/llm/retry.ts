// Retry-with-backoff for outbound LLM calls, shared by every feature that makes
// them. Only transient HTTP failures (429 and 5xx) are retried — an auth or
// validation failure is retried zero times, since repeating it cannot help.

import { APICallError } from 'ai';
import { createLogger } from '../logger.js';

const log = createLogger('llm:retry');

export function isRetryableHttpError(err: unknown): boolean {
	if (APICallError.isInstance(err)) {
		const s = err.statusCode;
		return s === 429 || (s !== undefined && s >= 500);
	}
	return false;
}

export async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
	let lastErr: unknown;
	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		try {
			return await fn();
		} catch (err) {
			lastErr = err;
			if (attempt < maxAttempts - 1 && isRetryableHttpError(err)) {
				const waitMs = Math.pow(2, attempt) * 1000;
				log.warn({ attempt, waitMs }, 'Transient provider error, retrying');
				await new Promise((r) => setTimeout(r, waitMs));
				continue;
			}
			throw err;
		}
	}
	throw lastErr;
}
