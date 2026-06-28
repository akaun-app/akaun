import type { PageServerLoad } from './$types.js';
import { db } from '$lib/server/db/client.js';
import { getInvoice } from '$lib/server/queries/invoices.js';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = ({ params, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	const invoice = getInvoice(db, parseInt(params.id));
	if (!invoice) throw error(404, 'Not found');
	return { invoice };
};
