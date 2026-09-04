import { redirect } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { db } from "$lib/server/db/client.js";
import { getInvoice } from "$lib/server/queries/invoices.js";
import { getSetting, SETTING_KEYS } from "$lib/server/settings.js";
import { getLayout } from "$lib/server/pdf/layouts/index.js";

export const GET: RequestHandler = async ({ params, locals }) => {
  if (!locals.user) throw redirect(302, "/login");

  const id = parseInt(params.id);
  const invoice = getInvoice(db, id);
  if (!invoice) throw redirect(302, "/invoices");

  const settings = {
    companyName: getSetting(db, SETTING_KEYS.companyName) ?? "",
    companyAddress: getSetting(db, SETTING_KEYS.companyAddress) ?? "",
    companyRegistrationNo:
      getSetting(db, SETTING_KEYS.companyRegistrationNo) ?? "",
    companyLogoPath: getSetting(db, SETTING_KEYS.companyLogoPath) ?? "",
  };
  const theme = {
    color: getSetting(db, SETTING_KEYS.pdfThemeColor) ?? "#1a56db",
  };

  try {
    const render = getLayout(getSetting(db, SETTING_KEYS.pdfInvoiceLayoutKey));
    const buffer = await render(
      {
        document: {
          ...invoice,
          contactName: invoice.contactName ?? null,
          contactAddress: invoice.contactAddress ?? null,
          contactRegistrationNo: invoice.contactRegistrationNo ?? null,
          contactPhone: invoice.contactPhone ?? null,
          paidMinor: invoice.paidMinor,
        },
        settings,
        docTypeLabel: "INVOICE",
      },
      theme,
      invoice.invoiceNumber,
    );
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${invoice.invoiceNumber}.pdf"`,
      },
    });
  } catch (err) {
    console.error("PDF generation failed for invoice", id, err);
    return new Response("PDF generation failed", { status: 500 });
  }
};
