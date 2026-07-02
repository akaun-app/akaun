import type { RequestHandler } from '@sveltejs/kit';
import { eq, and } from 'drizzle-orm';
import { db } from '$lib/server/db/client.js';
import { getExpense } from '$lib/server/queries/expenses.js';
import { expenseAttachments } from '$lib/server/db/schema.js';
import { deleteFile } from '$lib/server/file-storage.js';
import { hasPermission } from '$lib/server/permissions.js';
import { canDeleteExpenseAttachment } from '$lib/server/locking.js';
import { getSetting, SETTING_KEYS } from '$lib/server/settings.js';

export const DELETE: RequestHandler = async ({ locals, params }) => {
	if (!hasPermission(locals, 'expenses', 'change')) return new Response('Forbidden', { status: 403 });
	const expenseId = parseInt(params.id!);
	const attachmentId = parseInt(params.attachmentId!);

	const expense = getExpense(db, expenseId);
	if (!expense) return Response.json({ error: 'Not found' }, { status: 404 });

	const godMode = getSetting(db, SETTING_KEYS.godModeEnabled) === 'true';
	if (!canDeleteExpenseAttachment(expense, godMode)) {
		return Response.json(
			{
				error:
					'Attachment is locked — expense is linked to a completed claim. Enable God Mode to override.'
			},
			{ status: 403 }
		);
	}

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
