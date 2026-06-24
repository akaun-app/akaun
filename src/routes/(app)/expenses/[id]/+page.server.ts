import type { PageServerLoad, Actions } from './$types.js';
import { loadExpensesPage, expensesActions } from '$lib/server/loaders/expenses.js';

export const load: PageServerLoad = ({ locals, params }) =>
	loadExpensesPage(locals, parseInt(params.id) || null);
export const actions: Actions = expensesActions;
