import type { PageServerLoad } from './$types.js';
import { db } from '$lib/server/db/client.js';
import { getQuotation } from '$lib/server/queries/quotations.js';
import { getSetting } from '$lib/server/settings.js';
import { redirect } from '@sveltejs/kit';

export const load: PageServerLoad = ({ params, locals }) => {
	if (!locals.user) redirect(302, '/login');

	const id = parseInt(params.id);
	const quotation = getQuotation(db, id);
	if (!quotation) redirect(302, '/quotations');

	const settings = {
		companyName: getSetting(db, 'company.name') ?? '',
		companyAddress: getSetting(db, 'company.address') ?? '',
		companyRegistrationNo: getSetting(db, 'company.registrationNo') ?? ''
	};

	return { quotation, settings };
};
