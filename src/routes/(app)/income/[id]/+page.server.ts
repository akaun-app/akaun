import type { PageServerLoad, Actions } from './$types.js';
import { loadIncomePage, incomeActions } from '$lib/server/loaders/income.js';

export const load: PageServerLoad = ({ locals, params }) =>
	loadIncomePage(locals, parseInt(params.id) || null);
export const actions: Actions = incomeActions;
