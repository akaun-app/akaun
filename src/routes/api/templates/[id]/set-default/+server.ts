import type { RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/server/db/client.js';
import { getTemplate, setDefaultTemplate } from '$lib/server/queries/templates.js';
import { TemplateDocumentType } from '$lib/enums.js';

export const POST: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.isSuperuser) return new Response('Forbidden', { status: 403 });
	const id = parseInt(params.id!);
	const template = getTemplate(db, id);
	if (!template) return new Response('Not Found', { status: 404 });

	const body = await request.json().catch(() => ({}));
	// documentType to set as default for — defaults to the template's own documentType.
	// Useful when a template is typed as "Both" but you want to set it as default for
	// quotations specifically.
	let docType = body.documentType ?? template.documentType;
	if (docType === TemplateDocumentType.Both) {
		// Set as default for both quotations and invoices
		setDefaultTemplate(db, id, TemplateDocumentType.Quotation);
		setDefaultTemplate(db, id, TemplateDocumentType.Invoice);
	} else {
		setDefaultTemplate(db, id, docType as 1 | 2);
	}
	return new Response(null, { status: 204 });
};
