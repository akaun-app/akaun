import { AccountType, DefaultAccountPurpose } from "$lib/enums.js";
import type { PageServerLoad } from "./$types.js";
import { db } from "$lib/server/db/client.js";
import { importQueue } from "$lib/server/db/schema.js";
import { categoryChoices } from "$lib/server/import/category-accounts.js";
import {
  defaultAccountId,
  getAccount,
  listAccounts,
} from "$lib/server/queries/accounts.js";
import { requireAccountDefault } from "$lib/server/services/account-defaults.js";
import { desc } from "drizzle-orm";
import { redirect } from "@sveltejs/kit";
import { isMoneyPotAccount } from "$lib/server/ledger/account-type.js";
import { hasPermission } from "$lib/server/permissions.js";

export const load: PageServerLoad = async ({ locals }) => {
  if (!hasPermission(locals, "import", "view"))
    throw redirect(302, "/dashboard");

  // Shared ledger — show every job.
  const jobs = db
    .select()
    .from(importQueue)
    .orderBy(desc(importQueue.createdAt))
    .all();

  // Categories are accounts now (FR-006a); the review screen still picks one by
  // name, which is what the confirm step matches back to an account.
  const expenseCategories = categoryChoices(db, "expense").map((c) => c.name);
  const incomeCategories = categoryChoices(db, "income").map((c) => c.name);

  const moneyPotAccounts = listAccounts(db, { type: AccountType.Asset }).filter(
    isMoneyPotAccount,
  );

  // Accounts Payable is offered alongside the money pots for an expense job
  // only: picking it is how a reviewer says "I paid this personally, the
  // business owes me" rather than "it came out of the bank" (FR-008, FR-011).
  // Income has no equivalent — every income record is category → asset, with
  // no "not yet received" side to pick instead.
  const payable = requireAccountDefault(db, DefaultAccountPurpose.Payable);
  const payableAccount = payable.ok ? getAccount(db, payable.value) : null;

  return {
    jobs,
    expenseCategories,
    incomeCategories,
    accounts: moneyPotAccounts,
    expensePaymentAccounts: payableAccount
      ? [...moneyPotAccounts, payableAccount]
      : moneyPotAccounts,
    payableAccountId: payableAccount?.id ?? null,
    defaultAccountId: defaultAccountId(db),
  };
};
