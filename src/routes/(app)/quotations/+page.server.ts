import type { PageServerLoad, Actions } from './$types.js';
import { loadQuotationsPage, quotationsActions } from '$lib/server/loaders/quotations.js';

export const load: PageServerLoad = ({ locals }) => loadQuotationsPage(locals);
export const actions: Actions = quotationsActions;
