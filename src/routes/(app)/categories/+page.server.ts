import type { PageServerLoad } from "./$types.js";
import {
  loadCategoriesPage,
  accountsActions,
} from "$lib/server/loaders/accounts.js";

/** The bare list. Both routes share one loader and one set of actions. */
export const load: PageServerLoad = ({ locals }) =>
  loadCategoriesPage(locals, null);

// The same actions the Accounts screen uses — a category is an account, so
// creating, renaming and retiring one goes through the same service.
export const actions = accountsActions;
