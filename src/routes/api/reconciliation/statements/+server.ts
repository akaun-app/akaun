import type { RequestHandler } from "./$types.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "$lib/server/db/client.js";
import {
  MAX_UPLOAD_BYTES,
  saveReconciliationStatement,
  sniffAllowedType,
} from "$lib/server/file-storage.js";
import { hasPermission } from "$lib/server/permissions.js";
import {
  createStatement,
  listStatementSummaries,
  ReconciliationError,
} from "$lib/server/services/reconciliation.js";
import { processStatementImport } from "$lib/server/reconciliation/statement-import.js";

/**
 * A statement must say which account it belongs to (FR-021). Without it there
 * is no way to know which movements its lines could be, which is exactly how
 * money sitting in a wallet ended up offered against a bank statement.
 */
const accountIdSchema = z.coerce.number().int().positive();

export const GET: RequestHandler = ({ locals }) => {
  if (!locals.user) return new Response("Unauthorized", { status: 401 });
  if (!hasPermission(locals, "reconciliation", "view"))
    return new Response("Forbidden", { status: 403 });
  return Response.json({ statements: listStatementSummaries(db, locals) });
};
export const POST: RequestHandler = async ({ locals, request }) => {
  if (!locals.user) return new Response("Unauthorized", { status: 401 });
  if (!hasPermission(locals, "reconciliation", "add"))
    return new Response("Forbidden", { status: 403 });
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File))
    return Response.json({ error: "file is required" }, { status: 400 });
  const accountId = accountIdSchema.safeParse(form.get("accountId"));
  if (!accountId.success)
    return Response.json(
      { error: "Choose the account this statement belongs to" },
      { status: 400 },
    );
  if (file.size > MAX_UPLOAD_BYTES)
    return Response.json(
      { error: "File is larger than 15 MB" },
      { status: 413 },
    );
  const buffer = Buffer.from(await file.arrayBuffer());
  if (!sniffAllowedType(buffer))
    return Response.json(
      { error: "Only PDF, JPEG, and PNG statements are supported" },
      { status: 400 },
    );
  try {
    const path = saveReconciliationStatement(buffer, randomUUID(), file.name);
    const statement = createStatement(db, locals, {
      originalFilename: file.name,
      storedFilePath: path,
      accountId: accountId.data,
    });
    void processStatementImport(db, {
      statementId: statement.id,
      relativePath: path,
      originalFilename: file.name,
      userId: locals.user.id,
    });
    return Response.json(statement, { status: 202 });
  } catch (e) {
    if (e instanceof ReconciliationError)
      return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
};
