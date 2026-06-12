import type { RequestHandler } from '@sveltejs/kit';
import { eq, and } from 'drizzle-orm';
import { db } from '$lib/server/db/client.js';
import { incomeAttachments, incomes } from '$lib/server/db/schema.js';
import { deleteFile } from '$lib/server/file-storage.js';

export const DELETE: RequestHandler = async ({ locals, params }) => {
	const user = locals.user!;
	const incomeId = parseInt(params.id!);
	const attachmentId = parseInt(params.attachmentId!);

	const income = db
		.select({ id: incomes.id })
		.from(incomes)
		.where(and(eq(incomes.id, incomeId), eq(incomes.userId, user.id)))
		.get();

	if (!income) return Response.json({ error: 'Not found' }, { status: 404 });

	const attachment = db
		.delete(incomeAttachments)
		.where(
			and(eq(incomeAttachments.id, attachmentId), eq(incomeAttachments.incomeId, incomeId))
		)
		.returning()
		.get();

	if (!attachment) return Response.json({ error: 'Not found' }, { status: 404 });

	deleteFile(attachment.filename);
	return new Response(null, { status: 204 });
};
