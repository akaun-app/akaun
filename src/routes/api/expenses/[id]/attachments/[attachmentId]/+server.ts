import type { RequestHandler } from '@sveltejs/kit';
import { eq, and } from 'drizzle-orm';
import { db } from '$lib/server/db/client.js';
import { expenseAttachments, expenses } from '$lib/server/db/schema.js';
import { deleteFile } from '$lib/server/file-storage.js';
import { hasPermission } from '$lib/server/permissions.js';

export const DELETE: RequestHandler = async ({ locals, params }) => {
	if (!hasPermission(locals, 'expenses', 'change')) return new Response('Forbidden', { status: 403 });
	const expenseId = parseInt(params.id!);
	const attachmentId = parseInt(params.attachmentId!);

	const expense = db
		.select({ id: expenses.id })
		.from(expenses)
		.where(eq(expenses.id, expenseId))
		.get();

	if (!expense) return Response.json({ error: 'Not found' }, { status: 404 });

	const attachment = db
		.delete(expenseAttachments)
		.where(
			and(eq(expenseAttachments.id, attachmentId), eq(expenseAttachments.expenseId, expenseId))
		)
		.returning()
		.get();

	if (!attachment) return Response.json({ error: 'Not found' }, { status: 404 });

	deleteFile(attachment.filename);
	return new Response(null, { status: 204 });
};
