import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { db } from "$lib/server/db/client.js";
import { convertToInvoice } from "$lib/server/services/quotations.js";
import { getQuotation } from "$lib/server/queries/quotations.js";
import { getInvoice } from "$lib/server/queries/invoices.js";
import { hasPermission } from "$lib/server/permissions.js";
import { forbidden, notFound, refused } from "$lib/server/api-response.js";

/**
 * Converting a sent or accepted quotation into a draft invoice. It changes the
 * quotation (it becomes Converted) and adds an invoice, so it needs both
 * abilities — the same pair the Convert button is shown for.
 */
export const POST: RequestHandler = async ({ locals, params }) => {
  if (
    !hasPermission(locals, "quotations", "change") ||
    !hasPermission(locals, "invoices", "add")
  ) {
    return forbidden();
  }
  const id = parseInt(params.id!);
  if (!getQuotation(db, id))
    return notFound("That quotation no longer exists.");

  const result = convertToInvoice(db, id, locals.user!.id);
  if (!result.ok) return refused(result.reason);

  const quotation = getQuotation(db, result.value.quotationId);
  const invoice = getInvoice(db, result.value.invoiceId);
  return json({ quotation, invoice }, { status: 201 });
};
