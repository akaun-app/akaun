import { eq, and } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { settings } from './db/schema.js';

export const SETTING_KEYS = {
	currencyCode: 'display.currencyCode',
	expenseCategories: 'expense.categories',
	incomeCategories: 'income.categories',
	autoImportApiKey: 'autoImport.apiKey',
	autoImportModel: 'autoImport.model',
	autoImportEnabled: 'autoImport.enabled',
	autoImportParallelTasks: 'autoImport.parallelTasks',
	autoImportCategoryHints: 'autoImport.categoryHints',
	godModeEnabled: 'godMode.enabled',
	apiBearer: 'api.bearerToken'
} as const;

export function getSetting(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	db: BetterSQLite3Database<any>,
	userId: number,
	key: string
): string | null {
	const row = db
		.select({ value: settings.value })
		.from(settings)
		.where(and(eq(settings.userId, userId), eq(settings.key, key)))
		.get();
	return row?.value ?? null;
}

export function setSetting(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	db: BetterSQLite3Database<any>,
	userId: number,
	key: string,
	value: string
): void {
	db.insert(settings)
		.values({ userId, key, value })
		.onConflictDoUpdate({
			target: [settings.userId, settings.key],
			set: { value }
		})
		.run();
}
