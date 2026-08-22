import type { Actions } from "@sveltejs/kit";
import { db } from "$lib/server/db/client.js";
import { getInvoice, listInvoices } from "$lib/server/queries/invoices.js";
import { removeInvoice, issueInvoice } from "$lib/server/services/invoices.js";
import { InvoiceStatus } from "$lib/enums.js";
import { fail, redirect } from "@sveltejs/kit";
import { hasPermission } from "$lib/server/permissions.js";

export function loadInvoicesPage(locals: App.Locals) {
  if (!hasPermission(locals, "invoices", "view"))
    throw redirect(302, "/dashboard");
  const allInvoices = listInvoices(db, { limit: 1000 });

  // "Paid" is derived from what has been settled, never stored (D-10), so it is
  // counted off the invoice's payment state rather than off its status column.
  const counts = { all: 0, draft: 0, sent: 0, paid: 0, cancelled: 0 };
  allInvoices.forEach((inv) => {
    counts.all++;
    if (inv.status === InvoiceStatus.Cancelled) counts.cancelled++;
    else if (inv.status === InvoiceStatus.Draft) counts.draft++;
    else if (inv.paid) counts.paid++;
    else counts.sent++;
  });

  return { invoices: allInvoices, counts };
}

/**
 * One invoice, for `/invoices/[id]`.
 *
 * The list carries a summary row; the page needs the lines and the payments
 * that settled it, which the drawer used to fetch after opening — so the
 * numbers a reader came to check arrived a moment after the panel did.
 */
export function loadInvoiceDetail(locals: App.Locals, id: number) {
  if (!hasPermission(locals, "invoices", "view"))
    throw redirect(302, "/dashboard");

  const invoice = getInvoice(db, id);
  if (!invoice) throw redirect(302, "/invoices");

  return {
    invoice,
    perms: {
      change: hasPermission(locals, "invoices", "change"),
      delete: hasPermission(locals, "invoices", "delete"),
    },
  };
}

export const invoicesActions: Actions = {
  issue: async ({ locals, request }) => {
    if (!hasPermission(locals, "invoices", "change"))
      return fail(403, { error: "Forbidden" });
    const data = await request.formData();
    const id = parseInt(String(data.get("id") ?? "0"));
    if (!id) return fail(400, { error: "Invalid invoice" });
    const result = issueInvoice(db, id, locals.user!.id);
    if (!result.ok) return fail(409, { error: result.reason });
    return { success: true };
  },
  delete: async ({ locals, request }) => {
    if (!hasPermission(locals, "invoices", "delete"))
      return fail(403, { error: "Forbidden" });
    const userId = locals.user!.id;
    const data = await request.formData();
    const id = parseInt(String(data.get("id") ?? "0"));
    if (!id) return fail(400, { error: "Invalid invoice" });
    const result = removeInvoice(db, id, userId);
    if (!result.ok) {
      if (result.reason === "issued") {
        return fail(409, {
          error:
            "This invoice has been sent, so it cannot be deleted. Cancel it instead.",
        });
      }
      return fail(404, { error: "Invoice not found" });
    }
    return { success: true };
  },
};
