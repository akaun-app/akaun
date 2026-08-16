import { z } from "zod";
import type { RequestHandler } from "./$types.js";
import { db } from "$lib/server/db/client.js";
import {
  getStatementDetail,
  removeStatement,
  setStatementAccount,
  ReconciliationError,
} from "$lib/server/services/reconciliation.js";
const id = (v: string) => Number(v);
const fail = (e: unknown) =>
  e instanceof ReconciliationError
    ? Response.json({ error: e.message }, { status: e.status })
    : (() => {
        throw e;
      })();

/** Reassigning a statement to the right account (FR-034a). */
const patchSchema = z.object({
  accountId: z.number().int().positive(),
});

export const GET: RequestHandler = ({ locals, params }) => {
  try {
    return Response.json(
      getStatementDetail(db, locals, id(params.statementId)),
    );
  } catch (e) {
    return fail(e);
  }
};
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json(
      { error: "Choose the account this statement belongs to" },
      { status: 400 },
    );
  try {
    return Response.json(
      setStatementAccount(
        db,
        locals,
        id(params.statementId),
        parsed.data.accountId,
      ),
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
