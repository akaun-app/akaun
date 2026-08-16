import { eq, sql } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { settings, ledgerRecords, quotations, invoices } from "./db/schema.js";

export const SETTING_KEYS = {
  // Which account new records pre-select as the one that paid or received
  // (FR-011). Written by the ledger upgrade's account seeding, changeable in
  // Settings once more than one account exists.
  ledgerDefaultAccountId: "ledger_default_account_id",
  // The ledger upgrade's phase, before-snapshot, backup path and report (D-15).
  ledgerUpgradeState: "ledger_upgrade_state",
  currencyCode: "display.currencyCode",
  autoImportApiKey: "autoImport.apiKey",
  autoImportModel: "autoImport.model",
  autoImportEnabled: "autoImport.enabled",
  autoImportParallelTasks: "autoImport.parallelTasks",
  autoImportCategoryHints: "autoImport.categoryHints",
  autoImportRateLimitMs: "autoImport.rateLimitMs",
  autoImportFreeModelsOnly: "autoImport.freeModelsOnly",
  autoImportCustomInstructions: "autoImport.customInstructions",
  autoImportDuplicateThreshold: "autoImport.duplicateThreshold",
  companyName: "company.name",
  companyAddress: "company.address",
  companyRegistrationNo: "company.registrationNo",
  companyLogoPath: "company.logoPath",
  templateQuotationDefaultId: "template.quotation.defaultId",
  templateInvoiceDefaultId: "template.invoice.defaultId",
  sequenceTemplate: "documentNumbers.template",
} as const;

export function getSetting(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: BunSQLiteDatabase<any>,
  key: string,
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
  value: string,
): void {
  db.insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value },
    })
    .run();
}

// True once the business has issued any real document — at that point currency
// and sequence-number-format settings must become immutable, since changing
// either after the fact would corrupt historical amounts/numbering.
export function hasAnyDocuments(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: BunSQLiteDatabase<any>,
): boolean {
  return [ledgerRecords, quotations, invoices].some(
    (table) =>
      (db
        .select({ n: sql<number>`count(*)` })
        .from(table)
        .get()?.n ?? 0) > 0,
  );
}
