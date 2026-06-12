import type { RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/server/db/client.js';
import { claimAttachments } from '$lib/server/db/schema.js';
import { getClaim } from '$lib/server/queries/claims.js';
import { saveToTemp, moveToFinal, displayName } from '$lib/server/file-storage.js';

export const POST: RequestHandler = async ({ locals, params, request }) => {
	const user = locals.user!;
	const id = parseInt(params.id!);

	const claim = getClaim(db, id, user.id);
	if (!claim) return Response.json({ error: 'Not found' }, { status: 404 });

	const formData = await request.formData();
	const file = formData.get('file') as File | null;
	if (!file) return Response.json({ error: 'file field is required' }, { status: 400 });

	const buffer = Buffer.from(await file.arrayBuffer());
	const tempPath = saveToTemp(buffer, file.name);
	const finalPath = moveToFinal(tempPath, 'claims', claim.date);

	const attachment = db
		.insert(claimAttachments)
		.values({
			claimId: id,
			filename: finalPath,
			displayName: displayName(finalPath)
		})
		.returning()
		.get()!;

	return Response.json(attachment, { status: 201 });
};
