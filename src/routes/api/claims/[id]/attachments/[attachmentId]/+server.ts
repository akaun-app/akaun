import type { RequestHandler } from '@sveltejs/kit';
import { eq, and } from 'drizzle-orm';
import { db } from '$lib/server/db/client.js';
import { claimAttachments, claims } from '$lib/server/db/schema.js';
import { deleteFile } from '$lib/server/file-storage.js';
import { hasPermission } from '$lib/server/permissions.js';
import { canEditClaimData } from '$lib/server/locking.js';

export const DELETE: RequestHandler = async ({ locals, params }) => {
	if (!hasPermission(locals, 'claims', 'change')) return new Response('Forbidden', { status: 403 });
	const claimId = parseInt(params.id!);
	const attachmentId = parseInt(params.attachmentId!);

	const claim = db
		.select({ id: claims.id, status: claims.status })
		.from(claims)
		.where(eq(claims.id, claimId))
		.get();

	if (!claim) return Response.json({ error: 'Not found' }, { status: 404 });

	if (!canEditClaimData(claim)) {
		return Response.json(
			{ error: 'This claim is reimbursed and its attachments cannot be deleted.' },
			{ status: 403 }
		);
	}

	const attachment = db
		.delete(claimAttachments)
		.where(
			and(eq(claimAttachments.id, attachmentId), eq(claimAttachments.claimId, claimId))
		)
		.returning()
		.get();

	if (!attachment) return Response.json({ error: 'Not found' }, { status: 404 });

	deleteFile(attachment.filename);
	return new Response(null, { status: 204 });
};
