import { redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types.js';
import { loadQuotationDetail, quotationsActions } from '$lib/server/loaders/quotations.js';

export const load: PageServerLoad = ({ locals, params }) => {
	const id = Number(params.id);
	if (!Number.isInteger(id) || id <= 0) throw redirect(302, '/quotations');
	return loadQuotationDetail(locals, id);
};
/** Deleting still posts a form action; everything else goes through the API. */
export const actions: Actions = quotationsActions;
