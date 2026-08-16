import { and, asc, eq, sql } from "drizzle-orm";
import {
  accounts,
  categories,
  CATEGORY_TYPE,
  expenses,
  incomes,
} from "../../db/schema.js";
import { AccountRole, type AccountRoleCode } from "$lib/enums.js";
import { generateRanks, rankAfter } from "../rank.js";
import { setSetting, SETTING_KEYS } from "../../settings.js";
import type { LedgerDb } from "../types.js";

/**
 * Seeding the chart of accounts, before anything is moved into it (FR-032a).
 *
 * This has two jobs that look different and are the same job:
 *
 *  - On an existing installation it turns every `categories` row, and every
 *    category string any record actually used, into an account of the matching
 *    kind, so no record loses its category and every category total comes out
 *    the same (FR-033).
 *  - On a fresh installation there are no categories to convert, so it seeds
 *    the same default set the app used to create on every boot. That is why
 *    `ensureDefaultCategories()` could be deleted: its job moved here, and here
 *    it runs once rather than on every start (D-06).
 *
 * Idempotent throughout — an account is looked up by `(role, name)`, which is
 * the table's own unique index, so a rerun finds what the last run created and
 * adds nothing (FR-037).
 */

/** The default categories a new installation starts with. */
const SEED_EXPENSE_CATEGORIES = [
  "Food & Beverage",
  "Transport",
  "Accommodation",
  "Equipment",
  "Software & Subscriptions",
  "Office Supplies",
  "Marketing",
  "Professional Services",
  "Other",
];

const SEED_INCOME_CATEGORIES = [
  "Client Project",
  "Product Sales",
  "Consulting",
  "Investment",
  "Rental",
  // The invoice default: issuing an invoice earns into this unless another
  // income category is chosen (FR-018a).
  "Sales",
  "Other",
];

/**
 * The accounts the app itself needs. Each is created with `is_system` true, so
 * none of them can ever be deleted (FR-009), and with no opening balance, so
 * the records alone still produce today's totals (FR-010).
 */
const SYSTEM_ACCOUNTS: { name: string; role: AccountRoleCode }[] = [
  { name: "Bank Account", role: AccountRole.Bank },
  { name: "Money owed to us", role: AccountRole.Receivable },
  { name: "Money we owe", role: AccountRole.Payable },
  { name: "Opening balances", role: AccountRole.OpeningBalances },
  { name: "Uncategorised", role: AccountRole.ExpenseCategory },
];

export type SeededAccounts = {
  defaultAccountId: number;
  receivableAccountId: number;
  payableAccountId: number;
  openingBalancesAccountId: number;
  uncategorisedAccountId: number;
  salesAccountId: number;
  /** Every category account by name, per kind, for the conversion to look up. */
  expenseCategoryByName: Map<string, number>;
  incomeCategoryByName: Map<string, number>;
};

/** Finds an account by its unique `(role, name)`, or creates it. */
function ensureAccount(
  db: LedgerDb,
  role: AccountRoleCode,
  name: string,
  options: { isSystem?: boolean; rank?: string } = {},
): number {
  const existing = db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.role, role), eq(accounts.name, name)))
    .get();
  if (existing) return existing.id;

  const lastRank = db
    .select({ rank: accounts.rank })
    .from(accounts)
    .where(eq(accounts.role, role))
    .orderBy(sql`${accounts.rank} DESC`)
    .limit(1)
    .get()?.rank;

  return db
    .insert(accounts)
    .values({
      role,
      name,
      isSystem: options.isSystem ?? false,
      rank: options.rank ?? rankAfter(lastRank),
    })
    .returning({ id: accounts.id })
    .get()!.id;
}

/** Every category name a record actually used, whichever table it lived in. */
function categoryNamesInUse(db: LedgerDb): {
  expense: string[];
  income: string[];
} {
  const distinct = (rows: { category: string | null }[]) =>
    [
      ...new Set(
        rows
          .map((r) => (r.category ?? "").trim())
          .filter((name) => name.length > 0),
      ),
    ].sort();

  return {
    expense: distinct(
      db.selectDistinct({ category: expenses.category }).from(expenses).all(),
    ),
    income: distinct(
      db.selectDistinct({ category: incomes.category }).from(incomes).all(),
    ),
  };
}

export function seedAccounts(db: LedgerDb): SeededAccounts {
  const systemIds = new Map<string, number>();
  for (const account of SYSTEM_ACCOUNTS) {
    systemIds.set(
      account.name,
      ensureAccount(db, account.role, account.name, { isSystem: true }),
    );
  }

  const expenseCategoryByName = new Map<string, number>();
  const incomeCategoryByName = new Map<string, number>();

  // Every category the user defined, with its own rank so the order they put
  // them in survives (FR-033).
  const definedCategories = db
    .select({
      type: categories.type,
      name: categories.name,
      rank: categories.rank,
    })
    .from(categories)
    .orderBy(asc(categories.type), asc(categories.rank))
    .all();

  for (const row of definedCategories) {
    const isExpense = row.type === CATEGORY_TYPE.expense;
    const role = isExpense
      ? AccountRole.ExpenseCategory
      : AccountRole.IncomeCategory;
    const id = ensureAccount(db, role, row.name, { rank: row.rank });
    (isExpense ? expenseCategoryByName : incomeCategoryByName).set(
      row.name,
      id,
    );
  }

  // A fresh installation has no categories to convert, so it gets the same
  // default set the app used to create on every boot.
  if (definedCategories.length === 0) {
    const expenseRanks = generateRanks(SEED_EXPENSE_CATEGORIES.length);
    SEED_EXPENSE_CATEGORIES.forEach((name, i) => {
      expenseCategoryByName.set(
        name,
        ensureAccount(db, AccountRole.ExpenseCategory, name, {
          rank: expenseRanks[i],
        }),
      );
    });

    const incomeRanks = generateRanks(SEED_INCOME_CATEGORIES.length);
    SEED_INCOME_CATEGORIES.forEach((name, i) => {
      incomeCategoryByName.set(
        name,
        ensureAccount(db, AccountRole.IncomeCategory, name, {
          rank: incomeRanks[i],
        }),
      );
    });
  }

  // A category string a record used but that was never in the categories table
  // still has to become an account, or that record loses its category.
  const inUse = categoryNamesInUse(db);
  for (const name of inUse.expense) {
    if (expenseCategoryByName.has(name)) continue;
    expenseCategoryByName.set(
      name,
      ensureAccount(db, AccountRole.ExpenseCategory, name),
    );
  }
  for (const name of inUse.income) {
    if (incomeCategoryByName.has(name)) continue;
    incomeCategoryByName.set(
      name,
      ensureAccount(db, AccountRole.IncomeCategory, name),
    );
  }

  // The invoice default has to exist even on a database that already had
  // categories and never had one called Sales (FR-018a).
  const salesAccountId =
    incomeCategoryByName.get("Sales") ??
    ensureAccount(db, AccountRole.IncomeCategory, "Sales");
  incomeCategoryByName.set("Sales", salesAccountId);

  const defaultAccountId = systemIds.get("Bank Account")!;
  setSetting(db, SETTING_KEYS.ledgerDefaultAccountId, String(defaultAccountId));

  return {
    defaultAccountId,
    receivableAccountId: systemIds.get("Money owed to us")!,
    payableAccountId: systemIds.get("Money we owe")!,
    openingBalancesAccountId: systemIds.get("Opening balances")!,
    uncategorisedAccountId: systemIds.get("Uncategorised")!,
    salesAccountId,
    expenseCategoryByName,
    incomeCategoryByName,
  };
}
