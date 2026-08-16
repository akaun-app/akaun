import type { PageServerLoad, Actions } from "./$types.js";
import { loadLedgerPage, ledgerActions } from "$lib/server/loaders/ledger.js";
import { LedgerRecordKind } from "$lib/enums.js";

export const load: PageServerLoad = ({ locals }) =>
  loadLedgerPage(locals, LedgerRecordKind.Expense, null);
export const actions: Actions = ledgerActions;
