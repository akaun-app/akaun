import { AccountRole, type AccountRoleCode } from "$lib/enums.js";

/**
 * How the chart of accounts talks about itself on screen.
 *
 * The labels here are the everyday words, not the accounting ones (Principle
 * VII): a person picking where their money sits should not have to know what an
 * "asset" is. The technical role codes keep their own names in `enums.ts`.
 */
export const ROLE_LABELS: Record<AccountRoleCode, string> = {
  [AccountRole.Bank]: "Bank account",
  [AccountRole.Wallet]: "Wallet",
  [AccountRole.Cash]: "Cash",
  [AccountRole.Card]: "Card",
  [AccountRole.Equipment]: "Equipment",
  [AccountRole.Receivable]: "Money owed to us",
  [AccountRole.Payable]: "Money we owe",
  [AccountRole.OpeningBalances]: "Opening balances",
  [AccountRole.PartnerCapital]: "Money put in",
  [AccountRole.PartnerDrawings]: "Money taken out",
  [AccountRole.ExpenseCategory]: "Expense category",
  [AccountRole.IncomeCategory]: "Income category",
};

export function roleLabel(role: number): string {
  return ROLE_LABELS[role as AccountRoleCode] ?? "Account";
}

/**
 * The kinds someone may create, in the order the picker offers them. Mirrors
 * CREATABLE_ROLES in src/routes/api/accounts/+server.ts, which is the rule —
 * the shared owed accounts and Opening balances are seeded once, and a
 * partner's pair comes from granting that contact the Partner role.
 */
export const CREATABLE_ROLES: AccountRoleCode[] = [
  AccountRole.Bank,
  AccountRole.Wallet,
  AccountRole.Cash,
  AccountRole.Card,
  AccountRole.Equipment,
  AccountRole.ExpenseCategory,
  AccountRole.IncomeCategory,
];

/** What the Accounts screen offers when you add something. */
export const CREATABLE_ACCOUNT_ROLES: AccountRoleCode[] = [
  AccountRole.Bank,
  AccountRole.Wallet,
  AccountRole.Cash,
  AccountRole.Card,
  AccountRole.Equipment,
];

/** What the Categories screen offers when you add something. */
export const CREATABLE_CATEGORY_ROLES: AccountRoleCode[] = [
  AccountRole.ExpenseCategory,
  AccountRole.IncomeCategory,
];

/**
 * The sorts of account the list can be narrowed to, in the order the filter
 * offers them.
 *
 * These were the six headings the accounts screen grouped its rows under.
 * Grouping made the list longer than the screen the moment a business had a
 * dozen categories, and it answered a question nobody asked — someone looking
 * for "Fuel" wants to type "fuel", not to know which of six sections it lives
 * in. The words were already plain and already tested against the roles, so
 * they stay as *filter values* and the headings go (FR-015, research.md R-12).
 */
export const ROLE_FILTERS: { title: string; roles: AccountRoleCode[] }[] = [
  {
    title: "Where the money is",
    roles: [
      AccountRole.Bank,
      AccountRole.Wallet,
      AccountRole.Cash,
      AccountRole.Card,
    ],
  },
  {
    title: "What the business owns",
    roles: [AccountRole.Equipment],
  },
  {
    title: "Owed either way",
    roles: [AccountRole.Receivable, AccountRole.Payable],
  },
  {
    title: "The owners",
    roles: [
      AccountRole.OpeningBalances,
      AccountRole.PartnerCapital,
      AccountRole.PartnerDrawings,
    ],
  },
  {
    title: "Expense categories",
    roles: [AccountRole.ExpenseCategory],
  },
  {
    title: "Income categories",
    roles: [AccountRole.IncomeCategory],
  },
];

/** Every place money actually sits — the first filter's roles, by name. */
export const MONEY_POT_FILTER_ROLES: AccountRoleCode[] = ROLE_FILTERS[0].roles;

/**
 * Which screen an account belongs on.
 *
 * The line is the one every accounting system already draws: the balance sheet
 * on one side, the income statement on the other. Things with a balance a
 * reader would look for — where money sits, what is owed either way, what the
 * business owns and what the owners put in — are **accounts**. What money was
 * earned and spent *on* is a **category**.
 *
 * Both are rows in `accounts` and that is right: double-entry needs both sides
 * of a record to name an account, and a category is one side (002 FR-006a).
 * What changed is only where they are shown. A flat list of all of them was
 * tried and failed here: this installation has 22 categories against 4
 * balance-sheet accounts, so the screen read as nothing but categories.
 *
 * `Equipment` sits with the accounts. It is bought and kept rather than used
 * up, so it belongs on the balance sheet (002 FR-006b) — even though the record
 * form still offers it beside the categories when asking what a purchase was
 * for, which is a different list.
 */
export const ACCOUNT_ROLES: AccountRoleCode[] = [
  AccountRole.Bank,
  AccountRole.Wallet,
  AccountRole.Cash,
  AccountRole.Card,
  AccountRole.Equipment,
  AccountRole.Receivable,
  AccountRole.Payable,
  AccountRole.OpeningBalances,
  AccountRole.PartnerCapital,
  AccountRole.PartnerDrawings,
];

/** The income-statement half: what money was earned and spent on. */
export const CATEGORY_ROLES: AccountRoleCode[] = [
  AccountRole.ExpenseCategory,
  AccountRole.IncomeCategory,
];

/** The two halves of the Categories screen, in the words a person uses. */
export const CATEGORY_GROUPS: {
  id: string;
  title: string;
  role: AccountRoleCode;
}[] = [
  { id: "spending", title: "Spending", role: AccountRole.ExpenseCategory },
  { id: "earning", title: "Earning", role: AccountRole.IncomeCategory },
];
