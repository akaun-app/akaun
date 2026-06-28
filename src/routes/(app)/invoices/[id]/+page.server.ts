import type { PageServerLoad, Actions } from './$types.js';
import { loadInvoicesPage, invoicesActions } from '$lib/server/loaders/invoices.js';

export const load: PageServerLoad = ({ locals, params }) =>
	loadInvoicesPage(locals, parseInt(params.id) || null);
export const actions: Actions = invoicesActions;
