import { redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types.js';
import { loadInvoiceDetail, invoicesActions } from '$lib/server/loaders/invoices.js';

export const load: PageServerLoad = ({ locals, params }) => {
	const id = Number(params.id);
	if (!Number.isInteger(id) || id <= 0) throw redirect(302, '/invoices');
	return loadInvoiceDetail(locals, id);
};
/** Deleting still posts a form action; everything else goes through the API. */
export const actions: Actions = invoicesActions;
