import type { RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/server/db/client.js';
import { expenseAttachments } from '$lib/server/db/schema.js';
import { getExpense } from '$lib/server/queries/expenses.js';
import { saveToTemp, moveToFinal, displayName } from '$lib/server/file-storage.js';
import { hasPermission } from '$lib/server/permissions.js';

export const POST: RequestHandler = async ({ locals, params, request }) => {
	if (!hasPermission(locals, 'expenses', 'change')) return new Response('Forbidden', { status: 403 });
	const id = parseInt(params.id!);

	const expense = getExpense(db, id);
	if (!expense) return Response.json({ error: 'Not found' }, { status: 404 });

	const formData = await request.formData();
	const file = formData.get('file') as File | null;
	if (!file) return Response.json({ error: 'file field is required' }, { status: 400 });

	const buffer = Buffer.from(await file.arrayBuffer());
	const tempPath = saveToTemp(buffer, file.name);
	const finalPath = moveToFinal(tempPath, 'expenses', expense.date);

	const attachment = db
		.insert(expenseAttachments)
		.values({
			expenseId: id,
			filename: finalPath,
			displayName: displayName(finalPath)
		})
		.returning()
		.get()!;

	return Response.json(attachment, { status: 201 });
};
