import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db/client.js';
import { getInvoice } from '$lib/server/queries/invoices.js';
import { getSetting } from '$lib/server/settings.js';
import { buildInvoicePdf } from '$lib/server/pdf/invoice.js';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw redirect(302, '/login');

	const id = parseInt(params.id);
	const invoice = getInvoice(db, id);
	if (!invoice) throw redirect(302, '/invoices');

	const settings = {
		companyName: getSetting(db, 'company.name') ?? '',
		companyAddress: getSetting(db, 'company.address') ?? '',
		companyRegistrationNo: getSetting(db, 'company.registrationNo') ?? ''
	};

	try {
		const buffer = await buildInvoicePdf(invoice, settings);
		return new Response(new Uint8Array(buffer), {
			headers: {
				'Content-Type': 'application/pdf',
				'Content-Disposition': `inline; filename="${invoice.invoiceNumber}.pdf"`
			}
		});
	} catch (err) {
		console.error('PDF generation failed for invoice', id, err);
		return new Response('PDF generation failed', { status: 500 });
	}
};
