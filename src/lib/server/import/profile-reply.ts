import type { ProfileRefusal } from "../services/import-profiles.js";

/**
 * The reply when an import profile write is refused (006 FR-035 AS8).
 *
 * A profile that does not exist is a 404. Any other refusal is a profile that
 * breaks the rules, and is a 400 that carries every problem with its path,
 * such as `sections[0].extras.properties.order_no.type`, for the editor to
 * show beside each field. `reason` names the first few in one line, for a
 * caller that shows only a sentence. Nothing was written in either case.
 */
export function profileRefused(refusal: ProfileRefusal): Response {
  if (refusal.missing) {
    return Response.json({ error: refusal.reason }, { status: 404 });
  }
  return Response.json(
    { error: refusal.reason, reason: refusal.reason, errors: refusal.errors },
    { status: 400 },
  );
}

/**
 * A profile id from the address: a whole number with no leading zero, as the
 * table numbers them. Anything else names no profile and gives null.
 */
export function profileIdParam(raw: string | undefined): number | null {
  if (!raw || !/^[1-9][0-9]{0,14}$/.test(raw)) return null;
  return Number(raw);
}

/** The reply for an id that names no profile. */
export function profileNotFound(): Response {
  return Response.json(
    { error: "That import profile no longer exists." },
    { status: 404 },
  );
}
