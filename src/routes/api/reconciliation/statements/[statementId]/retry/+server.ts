import type { RequestHandler } from "./$types.js";
import { db } from "$lib/server/db/client.js";
import { processStatementImport } from "$lib/server/reconciliation/statement-import.js";
import {
  retryStatementExtraction,
  ReconciliationError,
} from "$lib/server/services/reconciliation.js";

export const POST: RequestHandler = ({ locals, params }) => {
  if (!locals.user) return new Response("Unauthorized", { status: 401 });
  try {
    const statement = retryStatementExtraction(
      db,
      locals,
      Number(params.statementId),
    );
    // Same fire-and-forget shape as the upload route: the statement is back in
    // the Extracting state, and the SSE stream reports where it lands.
    void processStatementImport(db, {
      statementId: statement.id,
      relativePath: statement.storedFilePath,
      originalFilename: statement.originalFilename,
      userId: locals.user.id,
    });
    return Response.json(statement, { status: 202 });
  } catch (e) {
    if (e instanceof ReconciliationError)
      return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
};
