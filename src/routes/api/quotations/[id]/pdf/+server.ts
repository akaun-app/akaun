import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db/client.js';
import { getQuotation } from '$lib/server/queries/quotations.js';
import { getSetting } from '$lib/server/settings.js';
import { buildQuotationPdf } from '$lib/server/pdf/quotation.js';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw redirect(302, '/login');

	const id = parseInt(params.id);
	const quotation = getQuotation(db, id);
	if (!quotation) throw redirect(302, '/quotations');

	const settings = {
		companyName: getSetting(db, 'company.name') ?? '',
		companyAddress: getSetting(db, 'company.address') ?? '',
		companyRegistrationNo: getSetting(db, 'company.registrationNo') ?? ''
	};

	try {
		const buffer = await buildQuotationPdf(quotation, settings);
		return new Response(new Uint8Array(buffer), {
			headers: {
				'Content-Type': 'application/pdf',
				'Content-Disposition': `inline; filename="${quotation.quotationNumber}.pdf"`
			}
		});
	} catch (err) {
		console.error('PDF generation failed for quotation', id, err);
		return new Response('PDF generation failed', { status: 500 });
	}
};
