import type { RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/server/db/client.js';
import { listTemplates, createTemplate } from '$lib/server/queries/templates.js';
import type { TemplateLayout } from '$lib/server/pdf/template-types.js';

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) return new Response('Unauthorized', { status: 401 });
	const docType = url.searchParams.get('documentType');
	const templates = listTemplates(db, docType ? parseInt(docType) : undefined);
	return Response.json(templates);
};

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.isSuperuser) return new Response('Forbidden', { status: 403 });
	const body = await request.json();
	if (!body.name || typeof body.name !== 'string') {
		return Response.json({ error: 'name is required' }, { status: 400 });
	}
	if (!body.documentType || ![1, 2, 3].includes(body.documentType)) {
		return Response.json({ error: 'documentType must be 1, 2, or 3' }, { status: 400 });
	}
	if (!body.layout) {
		return Response.json({ error: 'layout is required' }, { status: 400 });
	}
	const template = createTemplate(db, locals.user!.id, {
		name: body.name,
		documentType: body.documentType,
		themeColor: body.themeColor,
		themeFont: body.themeFont,
		layout: body.layout as TemplateLayout
	});
	return Response.json(template, { status: 201 });
};
