import PDFDocument from "pdfkit";
import { existsSync } from "fs";
import { join } from "path";
import { STORAGE_PATH } from "$lib/server/env.js";
import { fromMinor } from "$lib/server/ledger/money.js";
import type { LayoutRenderData, ThemeData } from "$lib/pdf/render-types.js";
import { registerPdfFonts } from "../fonts.js";
import { C, cleanText, fmt, fmtDate } from "../layout.js";

// Page geometry — US Letter, matching the reference invoice this layout is
// modeled on (measured from its /MediaBox: 612x792pt, 30pt margins). This is
// local to `classic.ts` rather than the shared M/CW in layout.ts, because
// `compact.ts` still targets A4 and shares none of these measurements.
const M = 30;
const PAGE_W = 612;
const CW = PAGE_W - 2 * M;

/** The latest settlement date, for "paid on <date>" — falls back to null if there's nothing to read. */
function latestSettlementDate(
  settlements: { createdAt: string }[] | undefined,
): string | null {
  if (!settlements || settlements.length === 0) return null;
  return settlements.reduce(
    (latest, s) => (s.createdAt > latest ? s.createdAt : latest),
    settlements[0].createdAt,
  );
}

// Line items table columns — widths measured from the reference invoice.
const QTY_W = 50;
const PRICE_W = 46;
const AMOUNT_W = 83;
const DESC_W = CW - QTY_W - PRICE_W - AMOUNT_W;
const QTY_X = M + DESC_W;
const PRICE_X = QTY_X + QTY_W;
const AMOUNT_X = PRICE_X + PRICE_W;

/** A tight, receipt-style layout: bold title + bold company name, label/value meta rows, two address columns, a bold total headline, and a compact line-items table. All text is black — emphasis comes from bold vs. regular weight, never from color. */
export function renderClassic(
  data: LayoutRenderData,
  theme: ThemeData,
  title: string,
): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc = new (PDFDocument as any)({
    size: [PAGE_W, 792],
    margin: 0,
    info: { Title: title },
  });
  const fonts = registerPdfFonts(doc);
  const { document: docu, settings, docTypeLabel } = data;
  const isInvoice = docTypeLabel === "INVOICE";
  const docNumber = docu.invoiceNumber ?? docu.quotationNumber ?? "";

  // A full-width accent bar along the very top edge of the page.
  doc.rect(0, 0, doc.page.width, 3).fill(theme.color);

  let y = M;

  // ── HEADER ────────────────────────────────────────────────────────────────
  const docTitle = docTypeLabel.charAt(0) + docTypeLabel.slice(1).toLowerCase();
  doc
    .font(fonts.bold)
    .fontSize(18)
    .fillColor(C.dark)
    .text(docTitle, M, y, { width: CW * 0.6 });
  doc
    .font(fonts.bold)
    .fontSize(18)
    .fillColor(C.muted)
    .text(cleanText(settings.companyName) || "Company", M, y, {
      width: CW,
      align: "right",
    });
  y += 48;

  // ── META ROWS (label/value, one line each) ──────────────────────────────
  const metaRows: [string, string][] = [
    [isInvoice ? "Invoice number" : "Quotation number", docNumber],
    ["Date of issue", fmtDate(docu.issueDate)],
  ];
  if (isInvoice && docu.dueDate) {
    metaRows.push([
      "Date due",
      fmtDate(docu.dueDate) + (docu.isOverdue ? " — overdue" : ""),
    ]);
  }
  if (!isInvoice && docu.expiryDate) {
    metaRows.push(["Valid until", fmtDate(docu.expiryDate)]);
  }
  if (docu.reference) metaRows.push(["Reference", cleanText(docu.reference)]);

  // 73.5pt fits "Invoice number" (measured from the reference invoice) — but
  // "Quotation number" and other labels can run longer, so widen the column
  // rather than let a longer label wrap onto two lines.
  doc.font(fonts.bold).fontSize(9);
  const LABEL_W = Math.max(
    73.5,
    ...metaRows.map(([label]) => doc.widthOfString(label) + 8),
  );

  for (const [label, value] of metaRows) {
    doc
      .font(fonts.bold)
      .fontSize(9)
      .fillColor(C.dark)
      .text(label, M, y, { width: LABEL_W });
    const labelBottom = doc.y;
    doc
      .font(fonts.bold)
      .fontSize(9)
      .fillColor(C.dark)
      .text(value, M + LABEL_W, y, { width: CW - LABEL_W });
    // A long label ("Quotation number" vs. "Invoice number") or value can
    // wrap onto a second line within its narrow column — advance past
    // whichever of the two actually ran taller, not a fixed line height, or
    // the next row overlaps the wrapped line.
    y = Math.max(labelBottom, doc.y, y + 13.5);
  }
  y += 14;

  // ── ADDRESS COLUMNS ──────────────────────────────────────────────────────
  // The reference gives the left (own company) column a narrow, fixed width
  // and starts the right (bill-to) column well before the content midpoint,
  // rather than splitting the row evenly.
  const leftColW = 200;
  const rightX = 250.79;
  const rightColW = M + CW - rightX;
  const addressTop = y;

  let leftY = addressTop;
  if (settings.companyLogoPath) {
    const absLogoPath = join(STORAGE_PATH, settings.companyLogoPath);
    if (existsSync(absLogoPath)) {
      doc.image(absLogoPath, M, leftY, { height: 20, fit: [leftColW, 20] });
      leftY += 26;
    }
  }
  doc
    .font(fonts.bold)
    .fontSize(9)
    .fillColor(C.dark)
    .text(cleanText(settings.companyName) || "Company", M, leftY, {
      width: leftColW,
    });
  leftY = doc.y + 2;
  if (settings.companyAddress) {
    doc
      .font(fonts.regular)
      .fontSize(9)
      .fillColor(C.dark)
      .text(cleanText(settings.companyAddress), M, leftY, { width: leftColW });
    leftY = doc.y + 2;
  }
  if (settings.companyRegistrationNo) {
    doc
      .font(fonts.regular)
      .fontSize(8)
      .fillColor(C.dark)
      .text("Reg. No: " + cleanText(settings.companyRegistrationNo), M, leftY, {
        width: leftColW,
      });
    leftY = doc.y;
  }

  let rightY = addressTop;
  if (docu.contactName) {
    doc
      .font(fonts.bold)
      .fontSize(9)
      .fillColor(C.dark)
      .text("Bill to", rightX, rightY, { width: rightColW });
    rightY = doc.y + 2;
    doc
      .font(fonts.bold)
      .fontSize(9)
      .fillColor(C.dark)
      .text(cleanText(docu.contactName), rightX, rightY, { width: rightColW });
    rightY = doc.y + 2;
    if (docu.contactAddress) {
      doc
        .font(fonts.regular)
        .fontSize(9)
        .fillColor(C.dark)
        .text(cleanText(docu.contactAddress), rightX, rightY, {
          width: rightColW,
        });
      rightY = doc.y + 2;
    }
    if (docu.contactRegistrationNo) {
      doc
        .font(fonts.regular)
        .fontSize(8)
        .fillColor(C.dark)
        .text(
          "Reg. No: " + cleanText(docu.contactRegistrationNo),
          rightX,
          rightY,
          { width: rightColW },
        );
      rightY = doc.y + 2;
    }
    if (docu.contactPhone) {
      doc
        .font(fonts.regular)
        .fontSize(8)
        .fillColor(C.dark)
        .text(cleanText(docu.contactPhone), rightX, rightY, {
          width: rightColW,
        });
      rightY = doc.y;
    }
  }

  y = Math.max(leftY, rightY) + 26;

  // ── BOLD HEADLINE ────────────────────────────────────────────────────────
  let headline: string;
  if (isInvoice) {
    if (docu.paid) {
      const paidDate = latestSettlementDate(docu.settlements) ?? docu.issueDate;
      headline = `${fmt(docu.total)} ${docu.currency} paid on ${fmtDate(paidDate)}`;
    } else {
      const due = fmt(fromMinor(docu.outstandingMinor ?? 0) || docu.total);
      headline =
        `${due} ${docu.currency} due` +
        (docu.dueDate ? ` ${fmtDate(docu.dueDate)}` : "");
    }
  } else {
    headline = `${fmt(docu.total)} ${docu.currency}`;
  }
  doc
    .font(fonts.bold)
    .fontSize(13.5)
    .fillColor(C.dark)
    .text(headline, M, y, { width: CW });
  y = doc.y + 20;

  // ── LINE ITEMS ───────────────────────────────────────────────────────────
  doc.font(fonts.regular).fontSize(7.5).fillColor(C.dark);
  doc.text("Description", M, y, { width: DESC_W });
  doc.text("Qty", QTY_X, y, { width: QTY_W, align: "center" });
  doc.text("Unit price", PRICE_X, y, { width: PRICE_W, align: "right" });
  doc.font(fonts.bold).fontSize(7.5).fillColor(C.dark);
  doc.text("Amount", AMOUNT_X, y, { width: AMOUNT_W, align: "right" });
  y += 12;
  doc
    .moveTo(M, y)
    .lineTo(M + CW, y)
    .lineWidth(1)
    .strokeColor(C.dark)
    .stroke();
  y += 8;

  for (const line of docu.lines) {
    const rowY = y;
    doc
      .font(fonts.regular)
      .fontSize(9.5)
      .fillColor(C.dark)
      .text(cleanText(line.description), M, rowY, { width: DESC_W });
    const rowEndY = doc.y;
    doc
      .font(fonts.regular)
      .fontSize(9.5)
      .fillColor(C.dark)
      .text(String(line.quantity), QTY_X, rowY, {
        width: QTY_W,
        align: "center",
      });
    doc
      .font(fonts.regular)
      .fontSize(9.5)
      .fillColor(C.dark)
      .text(fmt(line.unitPrice), PRICE_X, rowY, {
        width: PRICE_W,
        align: "right",
      });
    doc
      .font(fonts.bold)
      .fontSize(9.5)
      .fillColor(C.dark)
      .text(fmt(line.lineTotal), AMOUNT_X, rowY, {
        width: AMOUNT_W,
        align: "right",
      });
    y = Math.max(rowEndY, rowY + 13) + 4;
  }
  y += 6;
  doc
    .moveTo(M, y)
    .lineTo(M + CW, y)
    .lineWidth(1)
    .strokeColor(C.light)
    .stroke();
  y += 12;

  // ── TOTALS (label left-aligned from the content midpoint, value
  // right-aligned to the page margin — matching the reference) ────────────
  const totalsX = M + CW / 2;
  const totalsLabelW = AMOUNT_X - totalsX;

  doc
    .font(fonts.regular)
    .fontSize(9)
    .fillColor(C.dark)
    .text("Subtotal", totalsX, y, { width: totalsLabelW });
  doc
    .font(fonts.regular)
    .fontSize(9)
    .fillColor(C.dark)
    .text(fmt(docu.subtotal), AMOUNT_X, y, { width: AMOUNT_W, align: "right" });
  y += 14.25;

  if (docu.taxAmount) {
    doc
      .font(fonts.regular)
      .fontSize(9)
      .fillColor(C.dark)
      .text("Tax", totalsX, y, { width: totalsLabelW });
    doc
      .font(fonts.regular)
      .fontSize(9)
      .fillColor(C.dark)
      .text(fmt(docu.taxAmount), AMOUNT_X, y, {
        width: AMOUNT_W,
        align: "right",
      });
    y += 14.25;
  }

  doc
    .font(fonts.bold)
    .fontSize(9)
    .fillColor(C.dark)
    .text("Total", totalsX, y, { width: totalsLabelW });
  doc
    .font(fonts.bold)
    .fontSize(9)
    .fillColor(C.dark)
    .text(fmt(docu.total), AMOUNT_X, y, { width: AMOUNT_W, align: "right" });
  y += 14.25;

  if (isInvoice) {
    const label = docu.paid ? "Amount paid" : "Amount due";
    const amount = docu.paid
      ? fmt(docu.paidMinor ? fromMinor(docu.paidMinor) : docu.total)
      : fmt(fromMinor(docu.outstandingMinor ?? 0) || docu.total);
    doc
      .font(fonts.bold)
      .fontSize(9)
      .fillColor(C.dark)
      .text(label, totalsX, y, { width: totalsLabelW });
    doc
      .font(fonts.bold)
      .fontSize(9)
      .fillColor(C.dark)
      .text(`${amount} ${docu.currency}`, AMOUNT_X, y, {
        width: AMOUNT_W,
        align: "right",
      });
    y += 14.25;
  }
  y += 12;

  // ── NOTES / TERMS ────────────────────────────────────────────────────────
  if (docu.notes) {
    doc
      .font(fonts.bold)
      .fontSize(8)
      .fillColor(C.dark)
      .text("NOTES", M, y, { characterSpacing: 0.5 });
    y = doc.y + 3;
    doc
      .font(fonts.regular)
      .fontSize(9)
      .fillColor(C.dark)
      .text(cleanText(docu.notes), M, y, { width: CW });
    y = doc.y + 12;
  }
  if (docu.terms) {
    doc
      .font(fonts.bold)
      .fontSize(8)
      .fillColor(C.dark)
      .text("TERMS & CONDITIONS", M, y, { characterSpacing: 0.5 });
    y = doc.y + 3;
    doc
      .font(fonts.regular)
      .fontSize(9)
      .fillColor(C.dark)
      .text(cleanText(docu.terms), M, y, { width: CW });
  }

  // ── FOOTER (pinned to the page bottom — a single page is all this app renders) ──
  // Measured from the reference: the rule sits ~54pt above the bottom edge,
  // well below the M=30 body margin — this app's own footer, not a leftover
  // page margin.
  const footerRuleY = doc.page.height - 53.75;
  doc
    .moveTo(M, footerRuleY)
    .lineTo(M + CW, footerRuleY)
    .lineWidth(1)
    .strokeColor(C.light)
    .stroke();
  doc
    .font(fonts.regular)
    .fontSize(8)
    .fillColor(C.dark)
    .text("Page 1 of 1", M, footerRuleY + 8, { width: CW, align: "right" });

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}
