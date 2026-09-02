import { redirect } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { db } from "$lib/server/db/client.js";
import { getQuotation } from "$lib/server/queries/quotations.js";
import { getSetting, SETTING_KEYS } from "$lib/server/settings.js";
import { getLayout } from "$lib/server/pdf/layouts/index.js";
import { TemplateFont } from "$lib/enums.js";

export const GET: RequestHandler = async ({ params, locals }) => {
  if (!locals.user) throw redirect(302, "/login");

  const id = parseInt(params.id);
  const quotation = getQuotation(db, id);
  if (!quotation) throw redirect(302, "/quotations");

  const settings = {
    companyName: getSetting(db, SETTING_KEYS.companyName) ?? "",
    companyAddress: getSetting(db, SETTING_KEYS.companyAddress) ?? "",
    companyRegistrationNo:
      getSetting(db, SETTING_KEYS.companyRegistrationNo) ?? "",
    companyLogoPath: getSetting(db, SETTING_KEYS.companyLogoPath) ?? "",
  };
  const theme = {
    color: getSetting(db, SETTING_KEYS.pdfThemeColor) ?? "#1a56db",
    font: parseInt(
      getSetting(db, SETTING_KEYS.pdfThemeFont) ?? String(TemplateFont.Inter),
      10,
    ),
  };

  try {
    const render = getLayout(
      getSetting(db, SETTING_KEYS.pdfQuotationLayoutKey),
    );
    const buffer = await render(
      {
        document: {
          ...quotation,
          contactName: quotation.contactName ?? null,
          contactAddress: quotation.contactAddress ?? null,
          contactRegistrationNo: quotation.contactRegistrationNo ?? null,
          contactPhone: quotation.contactPhone ?? null,
        },
        settings,
        docTypeLabel: "QUOTATION",
      },
      theme,
      quotation.quotationNumber,
    );
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${quotation.quotationNumber}.pdf"`,
      },
    });
  } catch (err) {
    console.error("PDF generation failed for quotation", id, err);
    return new Response("PDF generation failed", { status: 500 });
  }
};
