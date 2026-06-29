import type { RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/server/db/client.js';
import { getTemplate } from '$lib/server/queries/templates.js';
import {
	sniffAllowedType,
	saveTemplateAsset,
	listTemplateAssets,
	MAX_UPLOAD_BYTES,
	MAX_TEMPLATE_ASSETS
} from '$lib/server/file-storage.js';
import { STORAGE_PATH } from '$lib/server/env.js';
import { join } from 'path';

export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) return new Response('Unauthorized', { status: 401 });
	const id = parseInt(params.id!);
	const template = getTemplate(db, id);
	if (!template) return new Response('Not Found', { status: 404 });
	const assets = listTemplateAssets(template.uuid).map((rel) => ({
		path: rel,
		url: `/api/files/${encodeURIComponent(rel)}`
	}));
	return Response.json(assets);
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.isSuperuser) return new Response('Forbidden', { status: 403 });
	const id = parseInt(params.id!);
	const template = getTemplate(db, id);
	if (!template) return new Response('Not Found', { status: 404 });

	// Enforce per-template asset cap
	const existing = listTemplateAssets(template.uuid);
	if (existing.length >= MAX_TEMPLATE_ASSETS) {
		return Response.json({ error: 'asset_limit_reached' }, { status: 409 });
	}

	const ct = request.headers.get('content-type') ?? '';
	if (!ct.includes('multipart/form-data')) {
		return Response.json({ error: 'multipart/form-data expected' }, { status: 400 });
	}

	const form = await request.formData();
	const file = form.get('file');
	if (!(file instanceof File)) {
		return Response.json({ error: 'file field required' }, { status: 400 });
	}
	if (file.size > MAX_UPLOAD_BYTES) {
		return Response.json({ error: 'file_too_large' }, { status: 413 });
	}

	const buffer = Buffer.from(await file.arrayBuffer());
	const type = sniffAllowedType(buffer);
	// Template assets: images only (jpeg/png), no PDFs
	if (type !== 'jpeg' && type !== 'png') {
		return Response.json({ error: 'jpeg or png required' }, { status: 415 });
	}

	const rel = saveTemplateAsset(buffer, template.uuid, file.name);
	return Response.json({ path: rel, url: `/api/files/${encodeURIComponent(rel)}` }, { status: 201 });
};
