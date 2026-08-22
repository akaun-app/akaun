import {
  AccountRole,
  AccountType,
  type AccountRoleCode,
  type AccountTypeCode,
} from "$lib/enums.js";
import { DEFAULT_CHART } from "../db/seed-accounts.js";

/**
 * The names a legacy book used for accounts the standardized chart already has.
 *
 * Exact-name matching gets `Packaging`, `Utilities` and `Product Sales` onto
 * their seeded codes by itself. It cannot get `Marketing` onto `Advertising`,
 * and the cost of that miss is not cosmetic: the seeded `Advertising` is created
 * beside `Marketing`, the saved default for the purpose points at the empty
 * seed, and every automatic record afterwards goes to the account with no
 * history in it (004 FR-029..FR-035).
 *
 * So the mapping is written down once, here, rather than guessed at run time. It
 * is a list of judgements about one real book, not a general synonym table:
 * anything not named below keeps its own account, its own name and its own code,
 * because 002 FR-033 requires every existing category to survive with the same
 * records against it.
 *
 * The last five entries are the accounts the legacy-to-ledger conversion invents
 * for itself (`seedLegacyAccounts` in `legacy-ledger-migration.ts`). They hold
 * every movement it writes, so they are the ones the saved defaults must name.
 */
export type AccountAlias = {
  /** The legacy name, compared with `normalizeAccountName`. */
  from: string;
  /**
   * The type the legacy account has when it carries that name.
   *
   * Stated rather than derived from the target, because `Other` is a real name
   * in two types and deriving it would silently pick one of them.
   */
  type: AccountTypeCode;
  /** The seeded `DEFAULT_CHART` code this name means. */
  toCode: number;
};

export const ACCOUNT_ALIASES: readonly AccountAlias[] = [
  // Categories in the real book that mean a seeded account under another name.
  { from: "Marketing", type: AccountType.Expense, toCode: 5100 },
  { from: "Software & Subscriptions", type: AccountType.Expense, toCode: 5400 },
  { from: "Logistics", type: AccountType.Expense, toCode: 5300 },
  { from: "Materials", type: AccountType.Expense, toCode: 5000 },
  { from: "Other", type: AccountType.Expense, toCode: 5900 },
  { from: "Other", type: AccountType.Revenue, toCode: 4100 },
  // The bridge accounts the legacy conversion creates for itself.
  { from: "Bank Account", type: AccountType.Asset, toCode: 1100 },
  { from: "Money owed to us", type: AccountType.Asset, toCode: 1200 },
  { from: "Money we owe", type: AccountType.Liability, toCode: 2000 },
  { from: "Opening balances", type: AccountType.Equity, toCode: 3000 },
  { from: "Uncategorised", type: AccountType.Expense, toCode: 5900 },
] as const;

/**
 * An account whose legacy *kind* was wrong, not just its name.
 *
 * Legacy stored equipment as an expense category, so buying something the
 * business keeps read as one big expense in the month it was bought — the exact
 * thing 002 FR-006b says must not happen. Retyping it moves those records off
 * the Profit & Loss and onto the balance sheet, which is a real change to every
 * historical P&L figure and is why it is a named list of one rather than a rule.
 */
export type AccountRetype = {
  name: string;
  fromType: AccountTypeCode;
  toType: AccountTypeCode;
  toRole: AccountRoleCode;
};

export const ACCOUNT_RETYPES: readonly AccountRetype[] = [
  {
    name: "Equipment",
    fromType: AccountType.Expense,
    toType: AccountType.Asset,
    toRole: AccountRole.Equipment,
  },
] as const;

/** The seeded account an alias points at, or null if the code is not seeded. */
export function aliasTarget(
  alias: AccountAlias,
): (typeof DEFAULT_CHART)[number] | null {
  return (
    DEFAULT_CHART.find(
      (seed) => seed.code === alias.toCode && seed.type === alias.type,
    ) ?? null
  );
}
