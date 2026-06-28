import type { PageServerLoad } from './$types.js';
import { db } from '$lib/server/db/client.js';
import { getInvoice } from '$lib/server/queries/invoices.js';
import { getSetting } from '$lib/server/settings.js';
import { redirect } from '@sveltejs/kit';

export const load: PageServerLoad = ({ params, locals }) => {
	if (!locals.user) throw redirect(302, '/login');
	const invoice = getInvoice(db, parseInt(params.id));
	if (!invoice) throw redirect(302, '/invoices');

	const settings = {
		companyName: getSetting(db, 'company.name') ?? '',
		companyAddress: getSetting(db, 'company.address') ?? '',
		companyRegistrationNo: getSetting(db, 'company.registrationNo') ?? ''
	};

	return { invoice, settings };
};
