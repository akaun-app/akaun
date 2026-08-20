import { and, eq, sql } from "drizzle-orm";
import { accounts } from "./schema.js";
import { AccountRole, type AccountRoleCode } from "$lib/enums.js";
import { generateRanks, rankAfter } from "../ledger/rank.js";
import { getSetting, setSetting, SETTING_KEYS } from "../settings.js";
import type { LedgerDb } from "../ledger/types.js";

/**
 * The chart of accounts a new installation starts with.
 *
 * This is the fresh-install half of the ledger upgrade's `seedAccounts()`,
 * rescued before that module is deleted with the tables it read (research.md
 * R-06). The other half — turning `categories` rows and the category *strings*
 * on old expense and income records into accounts — went with them: those
 * tables no longer exist, so there is nothing left to convert.
 *
 * Idempotent. Every account is looked up by role and name before it is created,
 * so this runs on every boot and adds nothing after the first (FR-037).
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

export function seedAccounts(db: LedgerDb): void {
  const systemIds = new Map<string, number>();
  for (const account of SYSTEM_ACCOUNTS) {
    systemIds.set(
      account.name,
      ensureAccount(db, account.role, account.name, { isSystem: true }),
    );
  }

  // Only seeded when there is no category of that kind at all. An installation
  // that already has its own categories is left alone — re-adding the defaults
  // on every boot is what the old `ensureDefaultCategories()` did, and what
  // made a deleted default come back.
  const hasExpenseCategory = db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.role, AccountRole.ExpenseCategory))
    .limit(1)
    .all()
    .some((row) => row.id !== systemIds.get("Uncategorised"));

  if (!hasExpenseCategory) {
    const ranks = generateRanks(SEED_EXPENSE_CATEGORIES.length);
    SEED_EXPENSE_CATEGORIES.forEach((name, i) => {
      ensureAccount(db, AccountRole.ExpenseCategory, name, { rank: ranks[i] });
    });
  }

  const hasIncomeCategory = db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.role, AccountRole.IncomeCategory))
    .limit(1)
    .get();

  if (!hasIncomeCategory) {
    const ranks = generateRanks(SEED_INCOME_CATEGORIES.length);
    SEED_INCOME_CATEGORIES.forEach((name, i) => {
      ensureAccount(db, AccountRole.IncomeCategory, name, { rank: ranks[i] });
    });
  }

  // The invoice default has to exist even on a database that already had
  // categories and never had one called Sales (FR-018a).
  ensureAccount(db, AccountRole.IncomeCategory, "Sales");

  // Which account a new record starts with (FR-011). Only set the first time;
  // an administrator may have chosen a different one in Settings since.
  const defaultAccountId = systemIds.get("Bank Account")!;
  if (getSetting(db, SETTING_KEYS.ledgerDefaultAccountId) === null) {
    setSetting(
      db,
      SETTING_KEYS.ledgerDefaultAccountId,
      String(defaultAccountId),
    );
  }
}
