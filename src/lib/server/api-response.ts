import type { ZodError } from "zod";

/**
 * The handful of replies every ledger endpoint shares, so the shapes documented
 * in specs/002-double-entry-ledger/contracts/api.md are written once.
 *
 * `reason` on a 409 is the plain sentence shown to the user, and it comes
 * straight from the rule that refused — a screen never has to invent its own
 * wording for a refusal (Principle VII).
 */

export function forbidden(): Response {
  return new Response("Forbidden", { status: 403 });
}

export function notFound(what = "That no longer exists."): Response {
  return Response.json({ error: what }, { status: 404 });
}

export function badRequest(error: ZodError): Response {
  return Response.json(
    { error: "Some of what was sent is not valid.", issues: error.issues },
    { status: 400 },
  );
}

/** A rule refused the write. The body carries the sentence to show. */
export function refused(reason: string): Response {
  return Response.json({ error: reason, reason }, { status: 409 });
}
