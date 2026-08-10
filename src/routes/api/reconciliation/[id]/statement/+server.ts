import type { RequestHandler } from './$types.js';
import { db } from '$lib/server/db/client.js';
import {
	MAX_UPLOAD_BYTES,
	saveReconciliationStatement,
	sniffAllowedType
} from '$lib/server/file-storage.js';
import { getEnabledProviders } from '$lib/server/llmProviders.js';
import { hasPermission } from '$lib/server/permissions.js';
import { ReconciliationError, uploadStatement } from '$lib/server/services/reconciliation.js';

export const POST: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.user) return new Response('Unauthorized', { status: 401 });
	if (!hasPermission(locals, 'reconciliation', 'add')) {
		return new Response('Forbidden', { status: 403 });
	}
	const id = Number(params.id);
	if (!Number.isInteger(id) || id <= 0) return Response.json({ error: 'Not found' }, { status: 404 });
	if (getEnabledProviders(db).length === 0) {
		return Response.json(
			{ error: 'No document extraction provider is configured', manualEntryAvailable: true },
			{ status: 409 }
		);
	}

	const form = await request.formData();
	const file = form.get('file');
	if (!(file instanceof File)) return Response.json({ error: 'file is required' }, { status: 400 });
	if (file.size > MAX_UPLOAD_BYTES) {
		return Response.json({ error: 'File is larger than 15 MB' }, { status: 413 });
	}
	const buffer = Buffer.from(await file.arrayBuffer());
	if (!sniffAllowedType(buffer)) {
		return Response.json({ error: 'Only PDF, JPEG, and PNG statements are supported' }, { status: 400 });
	}

	try {
		const relativePath = saveReconciliationStatement(buffer, id, file.name);
		return Response.json(uploadStatement(db, locals, id, { relativePath, originalFilename: file.name }), {
			status: 202
		});
	} catch (error) {
		if (error instanceof ReconciliationError) {
			return Response.json({ error: error.message, ...error.details }, { status: error.status });
		}
		throw error;
	}
};
