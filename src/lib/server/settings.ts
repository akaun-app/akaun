import { eq } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
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
	autoImportFreeModelsOnly: 'autoImport.freeModelsOnly',
	godModeEnabled: 'godMode.enabled',
	companyName: 'company.name',
	companyAddress: 'company.address',
	companyRegistrationNo: 'company.registrationNo'
} as const;

export function getSetting(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	db: BunSQLiteDatabase<any>,
	key: string
): string | null {
	const row = db
		.select({ value: settings.value })
		.from(settings)
		.where(eq(settings.key, key))
		.get();
	return row?.value ?? null;
}

export function setSetting(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	db: BunSQLiteDatabase<any>,
	key: string,
	value: string
): void {
	db.insert(settings)
		.values({ key, value })
		.onConflictDoUpdate({
			target: settings.key,
			set: { value }
		})
		.run();
}
