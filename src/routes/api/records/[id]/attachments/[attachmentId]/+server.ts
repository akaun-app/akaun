import type { RequestHandler } from "./$types.js";
import { db } from "$lib/server/db/client.js";
import { hasPermission } from "$lib/server/permissions.js";
import { forbidden, notFound } from "$lib/server/api-response.js";
import {
  deleteAttachment,
  getAttachment,
  getRecord,
} from "$lib/server/queries/ledger.js";
import { resourceForKind } from "$lib/server/ledger/record-permissions.js";
import { recordAudit } from "$lib/server/audit.js";
import { emitRecordUpdate } from "$lib/server/services/ledger.js";
import { deleteFile } from "$lib/server/file-storage.js";

export const DELETE: RequestHandler = async ({ locals, params }) => {
  const p = params as { id: string; attachmentId: string };
  const id = Number(p.id);
  const attachmentId = Number(p.attachmentId);
  if (!Number.isInteger(id) || !Number.isInteger(attachmentId)) {
    return notFound("That attachment no longer exists.");
  }

  const record = getRecord(db, id);
  if (!record) return notFound("That record no longer exists.");
  if (!hasPermission(locals, resourceForKind(record.kind), "change")) {
    return forbidden();
  }

  const attachment = getAttachment(db, attachmentId);
  if (!attachment || attachment.recordId !== id) {
    return notFound("That attachment no longer exists.");
  }

  if (!deleteAttachment(db, attachmentId)) {
    return notFound("That attachment no longer exists.");
  }
  // The row goes first: a file left behind is recoverable, a row pointing at a
  // file that is gone is not.
  deleteFile(attachment.filename);

  recordAudit(db, {
    recordType: "record",
    recordId: id,
    userId: locals.user!.id,
    action: "update",
    changes: [
      { field: "attachments", before: attachment.displayName, after: null },
    ],
  });
  emitRecordUpdate(db, id);

  return new Response(null, { status: 204 });
};
