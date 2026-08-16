import { MONEY_POT_ROLES } from "$lib/server/ledger/account-type.js";
import type { PageServerLoad } from "./$types.js";
import { db } from "$lib/server/db/client.js";
import { importQueue } from "$lib/server/db/schema.js";
import { categoryChoices } from "$lib/server/import/category-accounts.js";
import {
  defaultAccountId,
  listAccounts,
} from "$lib/server/queries/accounts.js";
import { desc } from "drizzle-orm";
import { redirect } from "@sveltejs/kit";
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

  return {
    jobs,
    expenseCategories,
    incomeCategories,
    accounts: listAccounts(db, { role: MONEY_POT_ROLES }),
    defaultAccountId: defaultAccountId(db),
  };
};
