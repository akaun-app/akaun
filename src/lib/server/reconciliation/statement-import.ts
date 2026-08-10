import { join } from 'node:path';
import { StatementExtractionState } from '$lib/enums.js';
import { STORAGE_PATH } from '$lib/server/env.js';
import { extractText, inferMimeType } from '$lib/server/extraction/document-text.js';
import { getEnabledProviders } from '$lib/server/llmProviders.js';
import { insertLines, updateSession, type ReconciliationDb } from '$lib/server/queries/reconciliation.js';
import { getSetting, SETTING_KEYS } from '$lib/server/settings.js';
import { normaliseExtractedLines } from './statement-parse.js';
import { extractStatementLines } from './statement-llm.js';
import { reconciliationEvents } from './events.js';

export async function processStatementImport(
	db: ReconciliationDb,
	input: {
		sessionId: number;
		periodEndDate: string;
		relativePath: string;
		originalFilename: string;
		userId: number;
	}
): Promise<void> {
	try {
		const text = await extractText(
			join(STORAGE_PATH, input.relativePath),
			inferMimeType(input.originalFilename)
		);
		if (text.trim().length < 10) throw new Error('Not enough readable statement text was found');

		const providers = getEnabledProviders(db);
		if (providers.length === 0) throw new Error('No document extraction provider is configured');
		const intervalMs = Number(getSetting(db, SETTING_KEYS.autoImportRateLimitMs) ?? 0);
		const extracted = await extractStatementLines(text, providers, intervalMs);
		const parsed = normaliseExtractedLines(extracted, input.periodEndDate);
		const lines = insertLines(
			db,
			parsed.map((line) => ({
				...line,
				sessionId: input.sessionId,
				sourceFile: input.relativePath
			}))
		);
		const session = updateSession(db, input.sessionId, {
			statementState: StatementExtractionState.Ready,
			statementError: null,
			updatedBy: input.userId
		});
		if (session) reconciliationEvents.emit('session-update', { session });
		reconciliationEvents.emit('lines-added', { sessionId: input.sessionId, lines });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Statement extraction failed';
		const session = updateSession(db, input.sessionId, {
			statementState: StatementExtractionState.Failed,
			statementError: `Statement extraction failed: ${message}`,
			updatedBy: input.userId
		});
		if (session) reconciliationEvents.emit('session-update', { session });
	}
}
