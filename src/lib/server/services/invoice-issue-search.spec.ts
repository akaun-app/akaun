import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AccountSubType, AccountType, DefaultAccountPurpose } from "$lib/enums.js";
import * as schema from "../db/schema.js";
import { accountDefaults, contacts, recordSearchText, users } from "../db/schema.js";
import { createAccount } from "./accounts.js";
import { createInvoice } from "../queries/invoices.js";
import { issueInvoice } from "./invoices.js";
import type { LedgerDb } from "../ledger/types.js";

/**
 * Issuing an invoice used to leave its ledger record findable only by its bare
 * description ("Invoice INV-xxx") and reference — the invoice's own notes,
 * terms and line items never made it into `record_search_text`, so a keyword
 * that only exists in a line item couldn't find the record from /records, even
 * though the same keyword was already searchable from /invoices. This spec
 * pins the fix in `reindexRecord` (`queries/ledger.ts`) and the follow-up
 * reindex `issueInvoice` now runs once the invoice is linked back to the
 * record (`invoices.spec.ts` pins that ordering against a fully mocked
 * `issueInvoice`; this one exercises the real path end to end against a real
 * database).
 */

let sqlite: Database;
let db: LedgerDb;
const userId = 1;

beforeEach(() => {
  sqlite = new Database(":memory:");
  db = drizzle(sqlite, { schema }) as unknown as LedgerDb;
  migrate(db as never, { migrationsFolder: "drizzle" });
  db.insert(users)
    .values({ email: "u@test", username: "u", passwordHash: "x" })
    .run();
});
afterEach(() => sqlite.close());

function revenueAccount(name: string) {
  const result = createAccount(db, userId, { name, type: AccountType.Revenue });
  if (!result.ok) throw new Error(result.reason);
  return result.value.id;
}

/** Invoice-issue posts the other side into Receivable — a saved default the
 * book must already have, same as any account-issued record. */
function receivableAccount(name: string) {
  const result = createAccount(db, userId, {
    name,
    type: AccountType.Asset,
    subType: AccountSubType.Receivable,
  });
  if (!result.ok) throw new Error(result.reason);
  db.insert(accountDefaults)
    .values({
      purpose: DefaultAccountPurpose.Receivable,
      accountId: result.value.id,
    })
    .run();
  return result.value.id;
}

describe("issuing an invoice", () => {
  it("makes the invoice's notes, terms and line items searchable from the ledger record too", () => {
    const income = revenueAccount("Sales");
    receivableAccount("Accounts Receivable");
    const contact = db
      .insert(contacts)
      .values({ entityType: 2, legalName: "Acme Hardware Sdn Bhd" })
      .returning()
      .get();

    const invoice = createInvoice(db, userId, {
      contactId: contact.id,
      issueDate: "2026-08-01",
      notes: "Delivered via courier",
      terms: "Net 30, late fee applies",
      lines: [
        { description: "Widget A shipment", quantity: 2, unitPrice: 50 },
        { description: "Installation service", quantity: 1, unitPrice: 20 },
      ],
    });

    const issued = issueInvoice(db, invoice.id, userId, {
      incomeAccountId: income,
    });
    if (!issued.ok) throw new Error(issued.reason);
    const recordId = issued.value.ledgerRecordId!;

    const row = db
      .select({ text: recordSearchText.text })
      .from(recordSearchText)
      .where(eq(recordSearchText.recordId, recordId))
      .get();

    expect(row?.text).toContain("Delivered via courier");
    expect(row?.text).toContain("Net 30, late fee applies");
    expect(row?.text).toContain("Widget A shipment");
    expect(row?.text).toContain("Installation service");
  });
});
