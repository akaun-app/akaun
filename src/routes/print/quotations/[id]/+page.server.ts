import type { PageServerLoad } from './$types.js';
import { db } from '$lib/server/db/client.js';
import { getQuotation } from '$lib/server/queries/quotations.js';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = ({ params, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	const quotation = getQuotation(db, parseInt(params.id));
	if (!quotation) throw error(404, 'Not found');
	return { quotation };
};
