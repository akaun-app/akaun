import type { RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/server/db/client.js';
import {
	getTemplate,
	updateTemplate,
	deleteTemplate,
	type TemplatePatch
} from '$lib/server/queries/templates.js';
import { deleteTemplateAssetFolder } from '$lib/server/file-storage.js';
import type { TemplateLayout } from '$lib/server/pdf/template-types.js';

export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) return new Response('Unauthorized', { status: 401 });
	const id = parseInt(params.id!);
	const template = getTemplate(db, id);
	if (!template) return new Response('Not Found', { status: 404 });
	return Response.json(template);
};

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.isSuperuser) return new Response('Forbidden', { status: 403 });
	const id = parseInt(params.id!);
	const body = await request.json();
	const patch: TemplatePatch = {};
	if (body.name !== undefined) patch.name = body.name;
	if (body.documentType !== undefined) patch.documentType = body.documentType;
	if (body.themeColor !== undefined) patch.themeColor = body.themeColor;
	if (body.themeFont !== undefined) patch.themeFont = body.themeFont;
	if (body.layout !== undefined) patch.layout = body.layout as TemplateLayout;
	const updated = updateTemplate(db, id, locals.user!.id, patch);
	if (!updated) return new Response('Not Found', { status: 404 });
	return Response.json(updated);
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	if (!locals.isSuperuser) return new Response('Forbidden', { status: 403 });
	const id = parseInt(params.id!);
	const template = getTemplate(db, id);
	if (!template) return new Response('Not Found', { status: 404 });
	const result = deleteTemplate(db, id);
	if (!result.ok) {
		return Response.json({ error: result.reason }, { status: 409 });
	}
	deleteTemplateAssetFolder(template.uuid);
	return new Response(null, { status: 204 });
};
