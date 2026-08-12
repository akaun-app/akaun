import type { RequestHandler } from "./$types.js";
import { db } from "$lib/server/db/client.js";
import {
  getStatementDetail,
  removeStatement,
  ReconciliationError,
} from "$lib/server/services/reconciliation.js";
const id = (v: string) => Number(v);
const fail = (e: unknown) =>
  e instanceof ReconciliationError
    ? Response.json({ error: e.message }, { status: e.status })
    : (() => {
        throw e;
      })();
export const GET: RequestHandler = ({ locals, params }) => {
  try {
    return Response.json(
      getStatementDetail(db, locals, id(params.statementId)),
    );
  } catch (e) {
    return fail(e);
  }
};
export const DELETE: RequestHandler = ({ locals, params }) => {
  try {
    removeStatement(db, locals, id(params.statementId));
    return new Response(null, { status: 204 });
  } catch (e) {
    return fail(e);
  }
};
