import PDFDocument from "pdfkit";
import { fromMinor } from "$lib/server/ledger/money.js";
import type { LayoutRenderData, ThemeData } from "$lib/pdf/render-types.js";
import { fontsForTheme } from "../fonts.js";
import { M, CW, C, fmt, fmtDate } from "../layout.js";

// Column layout for the tighter, single-line-per-row table below.
const QTY_W = 40;
const PRICE_W = 75;
const TOTAL_W = 75;
const DESC_W = CW - QTY_W - PRICE_W - TOTAL_W;
const QTY_X = M + DESC_W;
const PRICE_X = QTY_X + QTY_W;
const TOTAL_X = PRICE_X + PRICE_W;

/** A tighter single-column layout with smaller type and no wasted whitespace. */
export function renderCompact(
  data: LayoutRenderData,
  theme: ThemeData,
  title: string,
): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc = new (PDFDocument as any)({
    size: "A4",
    margin: 0,
    info: { Title: title },
  });
  const fonts = fontsForTheme(doc, theme);
  const { document: docu, settings, docTypeLabel } = data;

  // A colored accent band down the left margin gives the theme color a strong
  // presence without spending any vertical space on it.
  doc.rect(0, 0, 6, doc.page.height).fill(theme.color);

  let y = M * 0.7;
  const docNumber = docu.invoiceNumber ?? docu.quotationNumber ?? "";

  // ── HEADER (single row) ────────────────────────────────────────────────
  doc
    .font(fonts.bold)
    .fontSize(15)
    .fillColor(C.dark)
    .text(settings.companyName || "Company", M, y, { width: CW * 0.6 });
  doc
    .font(fonts.bold)
    .fontSize(13)
    .fillColor(theme.color)
    .text(`${docTypeLabel} ${docNumber}`, M, y + 1, {
      width: CW,
      align: "right",
    });
  y = doc.y + 3;

  const subtitleParts = [
    settings.companyAddress,
    settings.companyRegistrationNo && `Reg. ${settings.companyRegistrationNo}`,
  ]
    .filter(Boolean)
    .join("   ·   ");
  if (subtitleParts) {
    doc
      .font(fonts.regular)
      .fontSize(8)
      .fillColor(C.muted)
      .text(subtitleParts, M, y, { width: CW * 0.6 });
  }

  const metaParts = [
    `Issued ${fmtDate(docu.issueDate)}`,
    docu.dueDate &&
      `Due ${fmtDate(docu.dueDate)}${docu.isOverdue ? " (overdue)" : ""}`,
    docu.expiryDate && `Valid until ${fmtDate(docu.expiryDate)}`,
    docu.reference && `Ref ${docu.reference}`,
  ]
    .filter(Boolean)
    .join("   ·   ");
  doc
    .font(fonts.regular)
    .fontSize(8)
    .fillColor(docu.isOverdue ? C.red : C.muted)
    .text(metaParts, M, y, { width: CW, align: "right" });
  y = doc.y + 10;

  doc
    .moveTo(M, y)
    .lineTo(M + CW, y)
    .lineWidth(1)
    .strokeColor(theme.color)
    .stroke();
  y += 10;

  // ── BILL TO (single line) ──────────────────────────────────────────────
  if (docu.contactName) {
    doc
      .font(fonts.bold)
      .fontSize(8)
      .fillColor(C.muted)
      .text("BILL TO", M, y, { continued: true, characterSpacing: 0.5 });
    doc
      .font(fonts.regular)
      .fontSize(9)
      .fillColor(C.dark)
      .text(
        `  ${docu.contactName}${docu.contactAddress ? ", " + docu.contactAddress : ""}`,
        { width: CW - 50 },
      );
    y = doc.y + 8;
  }

  // ── LINE ITEMS (tight rows, alternating tint instead of rules) ─────────
  doc.font(fonts.bold).fontSize(7).fillColor(C.muted);
  doc.text("DESCRIPTION", M, y, { width: DESC_W, characterSpacing: 0.4 });
  doc.text("QTY", QTY_X, y, {
    width: QTY_W,
    align: "center",
    characterSpacing: 0.4,
  });
  doc.text("PRICE", PRICE_X, y, {
    width: PRICE_W,
    align: "right",
    characterSpacing: 0.4,
  });
  doc.text("TOTAL", TOTAL_X, y, {
    width: TOTAL_W,
    align: "right",
    characterSpacing: 0.4,
  });
  y += 12;

  docu.lines.forEach((line, i) => {
    const rowH = 16;
    if (i % 2 === 1) doc.rect(M, y - 2, CW, rowH).fill("#f7f7f7");
    doc.font(fonts.regular).fontSize(9).fillColor(C.body);
    doc.text(line.description, M + 4, y, { width: DESC_W - 4 });
    doc.text(String(line.quantity), QTY_X, y, {
      width: QTY_W,
      align: "center",
    });
    doc.text(fmt(line.unitPrice), PRICE_X, y, {
      width: PRICE_W,
      align: "right",
    });
    doc.text(fmt(line.lineTotal), TOTAL_X, y, {
      width: TOTAL_W - 4,
      align: "right",
    });
    y += rowH;
  });
  y += 6;

  // ── TOTALS (compact block, right-aligned) ──────────────────────────────
  const totalsW = PRICE_W + TOTAL_W + 30;
  const totalsX = M + CW - totalsW;
  doc
    .font(fonts.regular)
    .fontSize(8)
    .fillColor(C.muted)
    .text("Subtotal", totalsX, y, { width: totalsW - TOTAL_W, align: "right" });
  doc.text(fmt(docu.subtotal), TOTAL_X, y, { width: TOTAL_W, align: "right" });
  y += 12;
  doc
    .font(fonts.regular)
    .fontSize(8)
    .fillColor(C.muted)
    .text("Tax", totalsX, y, { width: totalsW - TOTAL_W, align: "right" });
  doc.text(fmt(docu.taxAmount), TOTAL_X, y, { width: TOTAL_W, align: "right" });
  y += 14;
  doc
    .font(fonts.bold)
    .fontSize(10)
    .fillColor(theme.color)
    .text(`Total (${docu.currency})`, totalsX, y, {
      width: totalsW - TOTAL_W,
      align: "right",
    });
  doc.text(fmt(docu.total), TOTAL_X, y, { width: TOTAL_W, align: "right" });
  y = doc.y + 12;

  if (docu.paidMinor && docu.paidMinor > 0) {
    doc
      .font(fonts.bold)
      .fontSize(8)
      .fillColor(C.green)
      .text(
        `Paid: ${docu.currency} ${fmt(fromMinor(docu.paidMinor))}`,
        totalsX,
        y,
        { width: totalsW, align: "right" },
      );
    y = doc.y + 10;
  }

  // ── NOTES / TERMS (small print, no rules) ──────────────────────────────
  if (docu.notes) {
    doc
      .font(fonts.bold)
      .fontSize(7)
      .fillColor(C.muted)
      .text("NOTES", M, y, { characterSpacing: 0.4 });
    doc
      .font(fonts.regular)
      .fontSize(8)
      .fillColor(C.subtle)
      .text(docu.notes, M, doc.y + 2, { width: CW });
    y = doc.y + 8;
  }
  if (docu.terms) {
    doc
      .font(fonts.bold)
      .fontSize(7)
      .fillColor(C.muted)
      .text("TERMS", M, y, { characterSpacing: 0.4 });
    doc
      .font(fonts.regular)
      .fontSize(8)
      .fillColor(C.subtle)
      .text(docu.terms, M, doc.y + 2, { width: CW });
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}
