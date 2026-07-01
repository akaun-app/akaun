import { eq, sql } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { settings, expenses, incomes, claims, quotations, invoices } from './db/schema.js';

export const SETTING_KEYS = {
	currencyCode: 'display.currencyCode',
	autoImportApiKey: 'autoImport.apiKey',
	autoImportModel: 'autoImport.model',
	autoImportEnabled: 'autoImport.enabled',
	autoImportParallelTasks: 'autoImport.parallelTasks',
	autoImportCategoryHints: 'autoImport.categoryHints',
	autoImportRateLimitMs: 'autoImport.rateLimitMs',
	autoImportFreeModelsOnly: 'autoImport.freeModelsOnly',
	autoImportCustomInstructions: 'autoImport.customInstructions',
	godModeEnabled: 'godMode.enabled',
	companyName: 'company.name',
	companyAddress: 'company.address',
	companyRegistrationNo: 'company.registrationNo',
	templateQuotationDefaultId: 'template.quotation.defaultId',
	templateInvoiceDefaultId: 'template.invoice.defaultId',
	sequenceTemplate: 'documentNumbers.template'
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

// True once the business has issued any real document — at that point currency
// and sequence-number-format settings must become immutable, since changing
// either after the fact would corrupt historical amounts/numbering.
export function hasAnyDocuments(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	db: BunSQLiteDatabase<any>
): boolean {
	return [expenses, incomes, claims, quotations, invoices].some(
		(table) => (db.select({ n: sql<number>`count(*)` }).from(table).get()?.n ?? 0) > 0
	);
}
