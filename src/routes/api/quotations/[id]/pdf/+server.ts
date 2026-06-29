import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db/client.js';
import { getQuotation } from '$lib/server/queries/quotations.js';
import { getSetting } from '$lib/server/settings.js';
import { getActiveTemplate } from '$lib/server/queries/templates.js';
import { buildPdfFromTemplate } from '$lib/server/pdf/renderer.js';
import { buildQuotationPdf } from '$lib/server/pdf/quotation.js';
import { TemplateDocumentType } from '$lib/enums.js';
import type { TemplateLayout } from '$lib/server/pdf/template-types.js';

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
		const templateRow = getActiveTemplate(db, TemplateDocumentType.Quotation);
		let buffer: Buffer;
		if (templateRow) {
			const layout = JSON.parse(templateRow.layoutJson) as TemplateLayout;
			buffer = await buildPdfFromTemplate(
				layout,
				{ color: templateRow.themeColor, font: templateRow.themeFont },
				{
					document: {
						...quotation,
						contactName: quotation.contactName ?? null,
						contactAddress: null,
						contactRegistrationNo: null,
						paidAt: null
					},
					settings,
					docTypeLabel: 'QUOTATION'
				},
				quotation.quotationNumber
			);
		} else {
			buffer = await buildQuotationPdf(quotation, settings);
		}
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
