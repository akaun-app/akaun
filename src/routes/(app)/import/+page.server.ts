import { DefaultAccountPurpose } from "$lib/enums.js";
import type { PageServerLoad } from "./$types.js";
import { db } from "$lib/server/db/client.js";
import { importQueue } from "$lib/server/db/schema.js";
import { categoryChoices } from "$lib/server/import/category-accounts.js";
import { getAccount, listAccounts } from "$lib/server/queries/accounts.js";
import { requireAccountDefault } from "$lib/server/services/account-defaults.js";
import { desc } from "drizzle-orm";
import { redirect } from "@sveltejs/kit";
import { hasPermission } from "$lib/server/permissions.js";
import {
  isImportIncomeTarget,
  isImportPurchaseSource,
} from "$lib/server/import/account-policy.js";

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
  const expenseChoices = categoryChoices(db, "expense");
  const incomeChoices = categoryChoices(db, "income");
  const expenseCategories = expenseChoices.map((c) => c.name);
  const incomeCategories = incomeChoices.map((c) => c.name);

  const allAccounts = listAccounts(db, {});

  // Accounts Payable is offered alongside the money pots for an expense job
  // only: picking it is how a reviewer says "I paid this personally, the
  // business owes me" rather than "it came out of the bank" (FR-008, FR-011).
  // Income has no equivalent — every income record is category → asset, with
  // no "not yet received" side to pick instead.
  const payable = requireAccountDefault(db, DefaultAccountPurpose.Payable);
  const payableAccount = payable.ok ? getAccount(db, payable.value) : null;
  const receivable = requireAccountDefault(
    db,
    DefaultAccountPurpose.Receivable,
  );
  const receivableAccount = receivable.ok
    ? getAccount(db, receivable.value)
    : null;
  const transactionDefault = requireAccountDefault(
    db,
    DefaultAccountPurpose.EverydayTransaction,
  );
  const uncategorised = requireAccountDefault(
    db,
    DefaultAccountPurpose.UncategorisedExpense,
  );
  const uncategorisedIncome = requireAccountDefault(
    db,
    DefaultAccountPurpose.UncategorisedIncome,
  );

  const expensePaymentAccounts = allAccounts.filter((account) =>
    isImportPurchaseSource(account, payableAccount?.id ?? null),
  );
  const incomeReceiptAccounts = allAccounts.filter((account) =>
    isImportIncomeTarget(account, receivableAccount?.id ?? null),
  );
  const categoryIds = new Set(
    [...expenseChoices, ...incomeChoices].map((choice) => choice.id),
  );
  const categoryAccounts = allAccounts.filter((account) =>
    categoryIds.has(account.id),
  );

  return {
    jobs,
    expenseCategories,
    incomeCategories,
    categoryAccounts,
    allAccounts,
    accounts: incomeReceiptAccounts,
    expensePaymentAccounts,
    payableAccountId: payableAccount?.id ?? null,
    receivableAccountId: receivableAccount?.id ?? null,
    uncategorisedAccountId: uncategorised.ok ? uncategorised.value : null,
    uncategorisedIncomeAccountId: uncategorisedIncome.ok
      ? uncategorisedIncome.value
      : null,
    defaultAccountId: transactionDefault.ok ? transactionDefault.value : null,
  };
};
