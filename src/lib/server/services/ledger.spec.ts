import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AccountSubType, AccountType, StatementDirection } from "$lib/enums.js";
import * as schema from "../db/schema.js";
import { users } from "../db/schema.js";
import { createAccount } from "./accounts.js";
import { createRecord, patchRecord } from "./ledger.js";
import { getRecord } from "../queries/ledger.js";
import type { LedgerDb } from "../ledger/types.js";

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

function bankAccount(name: string) {
  const result = createAccount(db, userId, {
    name,
    type: AccountType.Asset,
    subType: AccountSubType.Bank,
  });
  if (!result.ok) throw new Error(result.reason);
  return result.value.id;
}

function categoryAccount(name: string) {
  const result = createAccount(db, userId, { name, type: AccountType.Expense });
  if (!result.ok) throw new Error(result.reason);
  return result.value.id;
}

function makeExpense(categoryId: number, paidFromId: number) {
  const result = createRecord(db, userId, {
    kind: "expense",
    date: "2026-08-01",
    description: "Office supplies",
    amount: 50,
    currency: "USD",
    exchangeRate: 1,
    categoryAccountId: categoryId,
    paidFromAccountId: paidFromId,
  });
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}

function makeIncome(categoryId: number, receivedIntoId: number) {
  const result = createRecord(db, userId, {
    kind: "income",
    date: "2026-08-01",
    description: "Consulting fee",
    amount: 200,
    currency: "USD",
    exchangeRate: 1,
    categoryAccountId: categoryId,
    receivedIntoAccountId: receivedIntoId,
  });
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}

/** Fakes a settlement against `movementId`, the way a payment record would. */
function settle(
  movementId: number,
  otherMovementId: number,
  amountMinor: number,
) {
  db.insert(schema.settlements)
    .values({
      paymentMovementId: otherMovementId,
      owedMovementId: movementId,
      amountMinor,
    })
    .run();
}

/** Fakes a bank-line match against `movementId`, the way reconciliation would. */
function reconcile(accountId: number, movementId: number) {
  const statement = db
    .insert(schema.bankStatements)
    .values({
      originalFilename: "test.pdf",
      storedFilePath: "test.pdf",
      accountId,
    })
    .returning()
    .get();
  const line = db
    .insert(schema.bankStatementLines)
    .values({
      statementId: statement.id,
      date: "2026-08-01",
      amount: 50,
      direction: StatementDirection.Out,
    })
    .returning()
    .get();
  db.insert(schema.reconciliationAllocations)
    .values({ lineId: line.id, movementId, amount: 50, itemAmountSnapshot: 50 })
    .run();
}

describe("a settled Expense's category", () => {
  it("can still be corrected, without disturbing the settlement", () => {
    const category = categoryAccount("Office Supplies");
    const wrongCategory = categoryAccount("Wrong Category");
    const bank = bankAccount("Main Bank");
    const record = makeExpense(wrongCategory, bank);

    const paidFrom = record.movements.find((m) => m.amountMinor < 0)!;
    const category0 = record.movements.find((m) => m.amountMinor > 0)!;
    settle(paidFrom.id, category0.id, Math.abs(paidFrom.amountMinor));

    expect(getRecord(db, record.id)!.locked).toBe(true);

    const patched = patchRecord(db, record.id, userId, {
      categoryAccountId: category,
    });
    expect(patched.ok).toBe(true);
    if (!patched.ok) return;

    const categoryMovement = patched.value.movements.find(
      (m) => m.amountMinor > 0,
    )!;
    expect(categoryMovement.accountId).toBe(category);

    // The settled movement kept its id and its account, and the settlement
    // that pointed at it is still there — a rebuild never deleted it.
    const paidFromAfter = patched.value.movements.find(
      (m) => m.amountMinor < 0,
    )!;
    expect(paidFromAfter.id).toBe(paidFrom.id);
    expect(paidFromAfter.accountId).toBe(bank);
    const settlementsLeft = db.select().from(schema.settlements).all();
    expect(settlementsLeft.length).toBe(1);
  });

  it("still refuses to change the paid-from account", () => {
    const category = categoryAccount("Office Supplies");
    const bank = bankAccount("Main Bank");
    const otherBank = bankAccount("Other Bank");
    const record = makeExpense(category, bank);
    const paidFrom = record.movements.find((m) => m.amountMinor < 0)!;
    const categoryMovement = record.movements.find((m) => m.amountMinor > 0)!;
    settle(paidFrom.id, categoryMovement.id, Math.abs(paidFrom.amountMinor));

    const patched = patchRecord(db, record.id, userId, {
      paidFromAccountId: otherBank,
    });
    expect(patched.ok).toBe(false);
  });
});

describe("a reconciled Expense's category", () => {
  it("can still be corrected, without disturbing the bank match", () => {
    const category = categoryAccount("Office Supplies");
    const newCategory = categoryAccount("Correct Category");
    const bank = bankAccount("Main Bank");
    const record = makeExpense(category, bank);
    const paidFrom = record.movements.find((m) => m.amountMinor < 0)!;
    reconcile(bank, paidFrom.id);

    expect(getRecord(db, record.id)!.locked).toBe(true);

    const patched = patchRecord(db, record.id, userId, {
      categoryAccountId: newCategory,
    });
    expect(patched.ok).toBe(true);
    if (!patched.ok) return;

    expect(
      patched.value.movements.find((m) => m.amountMinor > 0)!.accountId,
    ).toBe(newCategory);
    const paidFromAfter = patched.value.movements.find(
      (m) => m.amountMinor < 0,
    )!;
    expect(paidFromAfter.id).toBe(paidFrom.id);
    const allocationsLeft = db
      .select()
      .from(schema.reconciliationAllocations)
      .all();
    expect(allocationsLeft.length).toBe(1);
  });
});

describe("a settled Income's category", () => {
  it("can still be corrected, without disturbing the settlement", () => {
    const category = categoryAccount("Wrong Income Category");
    const newCategory = categoryAccount("Consulting Income");
    const bank = bankAccount("Main Bank");
    const record = makeIncome(category, bank);

    const receivedInto = record.movements.find((m) => m.amountMinor > 0)!;
    const categoryMovement = record.movements.find((m) => m.amountMinor < 0)!;
    settle(receivedInto.id, categoryMovement.id, receivedInto.amountMinor);

    expect(getRecord(db, record.id)!.locked).toBe(true);

    const patched = patchRecord(db, record.id, userId, {
      categoryAccountId: newCategory,
    });
    expect(patched.ok).toBe(true);
    if (!patched.ok) return;

    expect(
      patched.value.movements.find((m) => m.amountMinor < 0)!.accountId,
    ).toBe(newCategory);
    const receivedIntoAfter = patched.value.movements.find(
      (m) => m.amountMinor > 0,
    )!;
    expect(receivedIntoAfter.id).toBe(receivedInto.id);
    expect(db.select().from(schema.settlements).all().length).toBe(1);
  });

  it("still refuses to change the received-into account", () => {
    const category = categoryAccount("Consulting Income");
    const bank = bankAccount("Main Bank");
    const otherBank = bankAccount("Other Bank");
    const record = makeIncome(category, bank);
    const receivedInto = record.movements.find((m) => m.amountMinor > 0)!;
    const categoryMovement = record.movements.find((m) => m.amountMinor < 0)!;
    settle(receivedInto.id, categoryMovement.id, receivedInto.amountMinor);

    const patched = patchRecord(db, record.id, userId, {
      receivedIntoAccountId: otherBank,
    });
    expect(patched.ok).toBe(false);
  });
});
