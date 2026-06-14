import type { RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/server/db/client.js';
import { incomeAttachments } from '$lib/server/db/schema.js';
import { getIncome } from '$lib/server/queries/income.js';
import { saveToTemp, moveToFinal, displayName } from '$lib/server/file-storage.js';
import { hasPermission } from '$lib/server/permissions.js';

export const POST: RequestHandler = async ({ locals, params, request }) => {
	if (!hasPermission(locals, 'income', 'change')) return new Response('Forbidden', { status: 403 });
	const user = locals.user!;
	const id = parseInt(params.id!);

	const income = getIncome(db, id, user.id);
	if (!income) return Response.json({ error: 'Not found' }, { status: 404 });

	const formData = await request.formData();
	const file = formData.get('file') as File | null;
	if (!file) return Response.json({ error: 'file field is required' }, { status: 400 });

	const buffer = Buffer.from(await file.arrayBuffer());
	const tempPath = saveToTemp(buffer, file.name);
	const finalPath = moveToFinal(tempPath, 'income', income.date);

	const attachment = db
		.insert(incomeAttachments)
		.values({
			incomeId: id,
			filename: finalPath,
			displayName: displayName(finalPath)
		})
		.returning()
		.get()!;

	return Response.json(attachment, { status: 201 });
};
