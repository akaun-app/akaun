import type { PageServerLoad, Actions } from './$types.js';
import { loadAccountsPage, accountsActions } from '$lib/server/loaders/accounts.js';

export const load: PageServerLoad = ({ locals, params }) =>
	loadAccountsPage(locals, parseInt(params.id) || null);
export const actions: Actions = accountsActions;
