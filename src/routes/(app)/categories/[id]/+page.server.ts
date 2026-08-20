import type { PageServerLoad } from "./$types.js";
import {
  loadCategoriesPage,
  accountsActions,
} from "$lib/server/loaders/accounts.js";

/**
 * The same list, with one category's drawer already open, so a category has an
 * address somebody can copy and send.
 *
 * The shared loader redirects to `/categories` when the id names nothing.
 */
export const load: PageServerLoad = ({ locals, params }) => {
  const openId = Number(params.id);
  return loadCategoriesPage(locals, Number.isInteger(openId) ? openId : null);
};

export const actions = accountsActions;
