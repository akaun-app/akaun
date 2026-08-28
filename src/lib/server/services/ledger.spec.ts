import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AccountSubType,
  AccountType,
  DefaultAccountPurpose,
  LedgerRecordKind,
  StatementDirection,
} from "$lib/enums.js";
import * as schema from "../db/schema.js";
import { accountDefaults, users } from "../db/schema.js";
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

/**
 * `sidesFromAccounts` needs a saved Receivable/Payable/Opening Balances
 * default whenever it runs, whatever the resulting shape actually uses —
 * a bare test database has none, so anything that restates both named
 * accounts (or, after the extra-sides fix, restates only `categoryAccountId`
 * on a split record) needs this seeded first.
 */
function seedMoneyDefaults() {
  const receivable = createAccount(db, userId, {
    name: "Accounts Receivable",
    type: AccountType.Asset,
    subType: AccountSubType.Receivable,
  });
  const payable = createAccount(db, userId, {
    name: "Accounts Payable",
    type: AccountType.Liability,
    subType: AccountSubType.AccountsPayable,
  });
  const opening = createAccount(db, userId, {
    name: "Opening Balances",
    type: AccountType.Equity,
  });
  if (!receivable.ok) throw new Error(receivable.reason);
  if (!payable.ok) throw new Error(payable.reason);
  if (!opening.ok) throw new Error(opening.reason);
  db.insert(accountDefaults)
    .values([
      {
        purpose: DefaultAccountPurpose.Receivable,
        accountId: receivable.value.id,
        updatedBy: userId,
      },
      {
        purpose: DefaultAccountPurpose.Payable,
        accountId: payable.value.id,
        updatedBy: userId,
      },
      {
        purpose: DefaultAccountPurpose.OpeningBalances,
        accountId: opening.value.id,
        updatedBy: userId,
      },
    ])
    .run();
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

function makeSplitExpense(
  bankId: number,
  cat1Id: number,
  cat1Minor: number,
  cat2Id: number,
  cat2Minor: number,
) {
  const result = createRecord(db, userId, {
    kind: "journal",
    date: "2026-08-01",
    description: "Supplier bill",
    amount: (cat1Minor + cat2Minor) / 100,
    currency: "USD",
    exchangeRate: 1,
    movements: [
      { accountId: bankId, amountMinor: -(cat1Minor + cat2Minor) },
      { accountId: cat1Id, amountMinor: cat1Minor },
      { accountId: cat2Id, amountMinor: cat2Minor },
    ],
    storedKind: LedgerRecordKind.Expense,
  });
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}

describe("a split Expense (one bill, two categories)", () => {
  it("keeps its extra category line when an unlocked field like the date changes", () => {
    seedMoneyDefaults();
    const bank = bankAccount("Main Bank");
    const fuel = categoryAccount("Fuel");
    const paper = categoryAccount("Paper");
    const record = makeSplitExpense(bank, fuel, 3000, paper, 2000);
    expect(record.movements.length).toBe(3);

    const paidFrom = record.movements.find((m) => m.amountMinor < 0)!;
    const fuelMovement = record.movements.find((m) => m.accountId === fuel)!;

    const patched = patchRecord(db, record.id, userId, {
      date: "2026-08-02",
      fromAccountId: paidFrom.accountId,
      toAccountId: fuelMovement.accountId,
      extraSides: [{ accountId: paper, amountMinor: 2000 }],
    });
    expect(patched.ok).toBe(true);
    if (!patched.ok) return;

    expect(patched.value.movements.length).toBe(3);
    // The record's "Amount" is the bill's total (50.00): the named category
    // takes what the typed extra side (paper, 20.00) leaves, so fuel keeps
    // its own 30.00 share rather than the whole 50.00.
    expect(
      patched.value.movements.some(
        (m) => m.accountId === fuel && m.amountMinor === 3000,
      ),
    ).toBe(true);
    expect(
      patched.value.movements.some(
        (m) => m.accountId === paper && m.amountMinor === 2000,
      ),
    ).toBe(true);
  });

  it("keeps its per-line labels when only the description changes", () => {
    seedMoneyDefaults();
    const bank = bankAccount("Main Bank");
    const fuel = categoryAccount("Fuel");
    const paper = categoryAccount("Paper");
    const created = createRecord(db, userId, {
      kind: "journal",
      date: "2026-08-01",
      description: "Scissors and paper",
      amount: 50,
      currency: "USD",
      exchangeRate: 1,
      movements: [
        { accountId: bank, amountMinor: -5000 },
        { accountId: fuel, amountMinor: 3000, label: "Scissors" },
        { accountId: paper, amountMinor: 2000, label: "Paper" },
      ],
      storedKind: LedgerRecordKind.Expense,
    });
    if (!created.ok) throw new Error(created.reason);
    const record = created.value;

    const patched = patchRecord(db, record.id, userId, {
      description: "Office supplies",
    });
    expect(patched.ok).toBe(true);
    if (!patched.ok) return;

    expect(
      patched.value.movements.find((m) => m.accountId === fuel)?.label,
    ).toBe("Scissors");
    expect(
      patched.value.movements.find((m) => m.accountId === paper)?.label,
    ).toBe("Paper");
  });

  it("keeps its extra category line when it is settled and only the primary category is corrected", () => {
    seedMoneyDefaults();
    const bank = bankAccount("Main Bank");
    const fuel = categoryAccount("Fuel");
    const paper = categoryAccount("Paper");
    const fuelCorrected = categoryAccount("Fuel - Corrected");
    const record = makeSplitExpense(bank, fuel, 3000, paper, 2000);

    const paidFrom = record.movements.find((m) => m.amountMinor < 0)!;
    const fuelMovement = record.movements.find((m) => m.accountId === fuel)!;
    settle(paidFrom.id, fuelMovement.id, Math.abs(paidFrom.amountMinor));
    expect(getRecord(db, record.id)!.locked).toBe(true);

    const patched = patchRecord(db, record.id, userId, {
      categoryAccountId: fuelCorrected,
    });
    expect(patched.ok).toBe(true);
    if (!patched.ok) return;

    expect(patched.value.movements.length).toBe(3);
    expect(
      patched.value.movements.some(
        (m) => m.accountId === paper && m.amountMinor === 2000,
      ),
    ).toBe(true);
    expect(
      patched.value.movements.some((m) => m.accountId === fuelCorrected),
    ).toBe(true);
  });

  it("can be split for the first time while settled, owed to a supplier", () => {
    seedMoneyDefaults();
    const fuel = categoryAccount("Fuel");
    const paper = categoryAccount("Paper");
    // Owed to a supplier rather than paid from a bank — `paidFromAccountId`
    // is null, so the money side is the saved Payable default itself.
    const created = createRecord(db, userId, {
      kind: "expense",
      date: "2026-08-01",
      description: "Supplier bill",
      amount: 50,
      currency: "USD",
      exchangeRate: 1,
      categoryAccountId: fuel,
      paidFromAccountId: null,
      contactId: 99,
    });
    if (!created.ok) throw new Error(created.reason);
    const record = created.value;
    expect(record.movements.length).toBe(2);

    const payableMovement = record.movements.find((m) => m.amountMinor < 0)!;
    const fuelMovement = record.movements.find((m) => m.amountMinor > 0)!;
    settle(
      payableMovement.id,
      fuelMovement.id,
      Math.abs(payableMovement.amountMinor),
    );
    expect(getRecord(db, record.id)!.locked).toBe(true);

    const patched = patchRecord(db, record.id, userId, {
      categoryAccountId: fuel,
      extraSides: [{ accountId: paper, amountMinor: 2000 }],
    });
    expect(patched.ok).toBe(true);
    if (!patched.ok) return;

    expect(patched.value.movements.length).toBe(3);
    // The whole 50.00 was already settled and stays fixed — fuel keeps only
    // what paper's new 20.00 share leaves it, 30.00.
    expect(
      patched.value.movements.some(
        (m) => m.accountId === fuel && m.amountMinor === 3000,
      ),
    ).toBe(true);
    expect(
      patched.value.movements.some(
        (m) => m.accountId === paper && m.amountMinor === 2000,
      ),
    ).toBe(true);
    const payableAfter = patched.value.movements.find(
      (m) => m.amountMinor < 0,
    )!;
    expect(payableAfter.id).toBe(payableMovement.id);
    expect(payableAfter.amountMinor).toBe(payableMovement.amountMinor);
    expect(db.select().from(schema.settlements).all().length).toBe(1);
  });

  it("refuses when the new extra lines already account for the whole settled amount", () => {
    seedMoneyDefaults();
    const bank = bankAccount("Main Bank");
    const fuel = categoryAccount("Fuel");
    const paper = categoryAccount("Paper");
    const record = makeExpense(fuel, bank);
    const paidFrom = record.movements.find((m) => m.amountMinor < 0)!;
    const fuelMovement = record.movements.find((m) => m.amountMinor > 0)!;
    settle(paidFrom.id, fuelMovement.id, Math.abs(paidFrom.amountMinor));

    const patched = patchRecord(db, record.id, userId, {
      extraSides: [{ accountId: paper, amountMinor: 5000 }],
    });
    expect(patched.ok).toBe(false);
  });

  it("uses the category's own typed amount instead of the remainder, when given", () => {
    seedMoneyDefaults();
    const bank = bankAccount("Main Bank");
    const fuel = categoryAccount("Fuel");
    const paper = categoryAccount("Paper");
    const record = makeExpense(fuel, bank);
    const paidFrom = record.movements.find((m) => m.amountMinor < 0)!;
    const fuelMovement = record.movements.find((m) => m.amountMinor > 0)!;
    settle(paidFrom.id, fuelMovement.id, Math.abs(paidFrom.amountMinor));

    // The 50.00 total stays fixed (it is locked), but the user wants fuel at
    // a specific 20.00 rather than whatever paper's 20.00 would leave it
    // (30.00) — so this deliberately does not balance, the same way typing a
    // wrong extra amount would not, and the server refuses it downstream.
    const patched = patchRecord(db, record.id, userId, {
      categoryAmountMinor: 2000,
      extraSides: [{ accountId: paper, amountMinor: 2000 }],
    });
    expect(patched.ok).toBe(false);

    const balanced = patchRecord(db, record.id, userId, {
      categoryAmountMinor: 3000,
      extraSides: [{ accountId: paper, amountMinor: 2000 }],
    });
    expect(balanced.ok).toBe(true);
    if (!balanced.ok) return;
    expect(
      balanced.value.movements.some(
        (m) => m.accountId === fuel && m.amountMinor === 3000,
      ),
    ).toBe(true);
  });

  it("can drop back to one category while settled, by sending no extra lines", () => {
    seedMoneyDefaults();
    const bank = bankAccount("Main Bank");
    const fuel = categoryAccount("Fuel");
    const paper = categoryAccount("Paper");
    const record = makeSplitExpense(bank, fuel, 3000, paper, 2000);
    const paidFrom = record.movements.find((m) => m.amountMinor < 0)!;
    const fuelMovement = record.movements.find((m) => m.accountId === fuel)!;
    settle(paidFrom.id, fuelMovement.id, Math.abs(paidFrom.amountMinor));

    const patched = patchRecord(db, record.id, userId, { extraSides: [] });
    expect(patched.ok).toBe(true);
    if (!patched.ok) return;

    expect(patched.value.movements.length).toBe(2);
    expect(
      patched.value.movements.some(
        (m) => m.accountId === fuel && m.amountMinor === 5000,
      ),
    ).toBe(true);
  });
});
