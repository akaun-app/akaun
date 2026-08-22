import type { PageServerLoad, Actions } from './$types.js';
import { loadAccountsPage, accountsActions } from '$lib/server/loaders/accounts.js';

export const load: PageServerLoad = ({ locals }) => loadAccountsPage(locals);
export const actions: Actions = accountsActions;
