import type { PageServerLoad, Actions } from './$types.js';
import { loadInvoicesPage, invoicesActions } from '$lib/server/loaders/invoices.js';

export const load: PageServerLoad = ({ locals }) => loadInvoicesPage(locals);
export const actions: Actions = invoicesActions;
