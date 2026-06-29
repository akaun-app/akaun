import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db/client.js';
import { getInvoice } from '$lib/server/queries/invoices.js';
import { getSetting } from '$lib/server/settings.js';
import { getActiveTemplate } from '$lib/server/queries/templates.js';
import { buildPdfFromTemplate } from '$lib/server/pdf/renderer.js';
import { buildInvoicePdf } from '$lib/server/pdf/invoice.js';
import { TemplateDocumentType } from '$lib/enums.js';
import type { TemplateLayout } from '$lib/server/pdf/template-types.js';

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
		const templateRow = getActiveTemplate(db, TemplateDocumentType.Invoice);
		let buffer: Buffer;
		if (templateRow) {
			const layout = JSON.parse(templateRow.layoutJson) as TemplateLayout;
			buffer = await buildPdfFromTemplate(
				layout,
				{ color: templateRow.themeColor, font: templateRow.themeFont },
				{
					document: {
						...invoice,
						contactName:           invoice.contactName           ?? null,
						contactAddress:        invoice.contactAddress        ?? null,
						contactRegistrationNo: invoice.contactRegistrationNo ?? null,
						contactPhone:          invoice.contactPhone          ?? null,
						paidAt: invoice.amountPaid > 0 ? 'paid' : null
					},
					settings,
					docTypeLabel: 'INVOICE'
				},
				invoice.invoiceNumber
			);
		} else {
			buffer = await buildInvoicePdf(invoice, settings);
		}
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
