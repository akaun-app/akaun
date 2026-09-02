import PDFDocument from "pdfkit";
import { existsSync } from "fs";
import { join } from "path";
import { STORAGE_PATH } from "$lib/server/env.js";
import { fromMinor } from "$lib/server/ledger/money.js";
import type { LayoutRenderData, ThemeData } from "$lib/pdf/render-types.js";
import { fontsForTheme } from "../fonts.js";
import { M, CW, C, fmt, fmtDate } from "../layout.js";

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

// Line items table columns.
const QTY_W = 50;
const PRICE_W = 85;
const AMOUNT_W = 85;
const DESC_W = CW - QTY_W - PRICE_W - AMOUNT_W;
const QTY_X = M + DESC_W;
const PRICE_X = QTY_X + QTY_W;
const AMOUNT_X = PRICE_X + PRICE_W;

/** A tight, receipt-style layout: bold title + grey company name, label/value meta rows, two address columns, a bold total headline, and a compact line-items table. */
export function renderClassic(
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
  const isInvoice = docTypeLabel === "INVOICE";
  const docNumber = docu.invoiceNumber ?? docu.quotationNumber ?? "";

  // A full-width accent bar along the very top edge of the page.
  doc.rect(0, 0, doc.page.width, 8).fill(theme.color);

  let y = M;

  // ── HEADER ────────────────────────────────────────────────────────────────
  const docTitle = docTypeLabel.charAt(0) + docTypeLabel.slice(1).toLowerCase();
  doc
    .font(fonts.bold)
    .fontSize(24)
    .fillColor(C.dark)
    .text(docTitle, M, y, { width: CW * 0.6 });
  doc
    .font(fonts.bold)
    .fontSize(22)
    .fillColor(C.muted)
    .text(settings.companyName || "Company", M, y, {
      width: CW,
      align: "right",
    });
  y += 48;

  // ── META ROWS (label/value, one line each) ──────────────────────────────
  const LABEL_W = 100;
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
  if (docu.reference) metaRows.push(["Reference", docu.reference]);

  for (const [label, value] of metaRows) {
    doc
      .font(fonts.bold)
      .fontSize(9)
      .fillColor(C.dark)
      .text(label, M, y, { width: LABEL_W });
    doc
      .font(fonts.regular)
      .fontSize(9)
      .fillColor(C.dark)
      .text(value, M + LABEL_W, y, { width: CW - LABEL_W });
    y += 14;
  }
  y += 14;

  // ── ADDRESS COLUMNS ──────────────────────────────────────────────────────
  const colW = CW / 2 - 12;
  const rightX = M + CW / 2 + 12;
  const addressTop = y;

  let leftY = addressTop;
  if (settings.companyLogoPath) {
    const absLogoPath = join(STORAGE_PATH, settings.companyLogoPath);
    if (existsSync(absLogoPath)) {
      doc.image(absLogoPath, M, leftY, { height: 20, fit: [colW, 20] });
      leftY += 26;
    }
  }
  doc
    .font(fonts.bold)
    .fontSize(10)
    .fillColor(C.dark)
    .text(settings.companyName || "Company", M, leftY, { width: colW });
  leftY = doc.y + 2;
  if (settings.companyAddress) {
    doc
      .font(fonts.regular)
      .fontSize(9)
      .fillColor(C.subtle)
      .text(settings.companyAddress, M, leftY, { width: colW });
    leftY = doc.y + 2;
  }
  if (settings.companyRegistrationNo) {
    doc
      .font(fonts.regular)
      .fontSize(8)
      .fillColor(C.muted)
      .text("Reg. No: " + settings.companyRegistrationNo, M, leftY, {
        width: colW,
      });
    leftY = doc.y;
  }

  let rightY = addressTop;
  if (docu.contactName) {
    doc
      .font(fonts.bold)
      .fontSize(8)
      .fillColor(C.muted)
      .text("BILL TO", rightX, rightY, { width: colW, characterSpacing: 0.5 });
    rightY = doc.y + 2;
    doc
      .font(fonts.bold)
      .fontSize(10)
      .fillColor(C.dark)
      .text(docu.contactName, rightX, rightY, { width: colW });
    rightY = doc.y + 2;
    if (docu.contactAddress) {
      doc
        .font(fonts.regular)
        .fontSize(9)
        .fillColor(C.subtle)
        .text(docu.contactAddress, rightX, rightY, { width: colW });
      rightY = doc.y + 2;
    }
    if (docu.contactRegistrationNo) {
      doc
        .font(fonts.regular)
        .fontSize(8)
        .fillColor(C.muted)
        .text("Reg. No: " + docu.contactRegistrationNo, rightX, rightY, {
          width: colW,
        });
      rightY = doc.y + 2;
    }
    if (docu.contactPhone) {
      doc
        .font(fonts.regular)
        .fontSize(8)
        .fillColor(C.muted)
        .text(docu.contactPhone, rightX, rightY, { width: colW });
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
    .fontSize(15)
    .fillColor(C.dark)
    .text(headline, M, y, { width: CW });
  y = doc.y + 20;

  // ── LINE ITEMS ───────────────────────────────────────────────────────────
  doc.font(fonts.regular).fontSize(8).fillColor(C.muted);
  doc.text("Description", M, y, { width: DESC_W });
  doc.text("Qty", QTY_X, y, { width: QTY_W, align: "center" });
  doc.text("Unit price", PRICE_X, y, { width: PRICE_W, align: "right" });
  doc.text("Amount", AMOUNT_X, y, { width: AMOUNT_W, align: "right" });
  y += 12;
  doc
    .moveTo(M, y)
    .lineTo(M + CW, y)
    .lineWidth(0.5)
    .strokeColor(C.dark)
    .stroke();
  y += 8;

  for (const line of docu.lines) {
    const rowY = y;
    doc
      .font(fonts.regular)
      .fontSize(9.5)
      .fillColor(C.body)
      .text(line.description, M, rowY, { width: DESC_W });
    const rowEndY = doc.y;
    doc
      .font(fonts.regular)
      .fontSize(9.5)
      .fillColor(C.body)
      .text(String(line.quantity), QTY_X, rowY, {
        width: QTY_W,
        align: "center",
      });
    doc
      .font(fonts.regular)
      .fontSize(9.5)
      .fillColor(C.body)
      .text(fmt(line.unitPrice), PRICE_X, rowY, {
        width: PRICE_W,
        align: "right",
      });
    doc
      .font(fonts.regular)
      .fontSize(9.5)
      .fillColor(C.body)
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
    .lineWidth(0.5)
    .strokeColor(C.light)
    .stroke();
  y += 12;

  // ── TOTALS (right-aligned, theme-colored labels) ────────────────────────
  const totalsLabelW = 90;
  const totalsX = M + CW - (totalsLabelW + AMOUNT_W);

  doc
    .font(fonts.regular)
    .fontSize(9)
    .fillColor(theme.color)
    .text("Subtotal", totalsX, y, { width: totalsLabelW, align: "right" });
  doc
    .font(fonts.regular)
    .fontSize(9)
    .fillColor(C.dark)
    .text(fmt(docu.subtotal), AMOUNT_X, y, { width: AMOUNT_W, align: "right" });
  y += 15;

  if (docu.taxAmount) {
    doc
      .font(fonts.regular)
      .fontSize(9)
      .fillColor(theme.color)
      .text("Tax", totalsX, y, { width: totalsLabelW, align: "right" });
    doc
      .font(fonts.regular)
      .fontSize(9)
      .fillColor(C.dark)
      .text(fmt(docu.taxAmount), AMOUNT_X, y, {
        width: AMOUNT_W,
        align: "right",
      });
    y += 15;
  }

  doc
    .font(fonts.bold)
    .fontSize(9)
    .fillColor(theme.color)
    .text("Total", totalsX, y, { width: totalsLabelW, align: "right" });
  doc
    .font(fonts.bold)
    .fontSize(9)
    .fillColor(C.dark)
    .text(fmt(docu.total), AMOUNT_X, y, { width: AMOUNT_W, align: "right" });
  y += 15;

  if (isInvoice) {
    const label = docu.paid ? "Amount paid" : "Amount due";
    const amount = docu.paid
      ? fmt(docu.paidMinor ? fromMinor(docu.paidMinor) : docu.total)
      : fmt(fromMinor(docu.outstandingMinor ?? 0) || docu.total);
    doc
      .font(fonts.bold)
      .fontSize(9)
      .fillColor(theme.color)
      .text(label, totalsX, y, { width: totalsLabelW, align: "right" });
    doc
      .font(fonts.bold)
      .fontSize(9)
      .fillColor(C.dark)
      .text(`${amount} ${docu.currency}`, AMOUNT_X, y, {
        width: AMOUNT_W,
        align: "right",
      });
    y += 15;
  }
  y += 12;

  // ── NOTES / TERMS ────────────────────────────────────────────────────────
  if (docu.notes) {
    doc
      .font(fonts.bold)
      .fontSize(8)
      .fillColor(C.muted)
      .text("NOTES", M, y, { characterSpacing: 0.5 });
    y = doc.y + 3;
    doc
      .font(fonts.regular)
      .fontSize(9)
      .fillColor(C.subtle)
      .text(docu.notes, M, y, { width: CW });
    y = doc.y + 12;
  }
  if (docu.terms) {
    doc
      .font(fonts.bold)
      .fontSize(8)
      .fillColor(C.muted)
      .text("TERMS & CONDITIONS", M, y, { characterSpacing: 0.5 });
    y = doc.y + 3;
    doc
      .font(fonts.regular)
      .fontSize(9)
      .fillColor(C.subtle)
      .text(docu.terms, M, y, { width: CW });
  }

  // ── FOOTER (pinned to the page bottom — a single page is all this app renders) ──
  const footerRuleY = doc.page.height - M + 6;
  doc
    .moveTo(M, footerRuleY)
    .lineTo(M + CW, footerRuleY)
    .lineWidth(0.5)
    .strokeColor(C.light)
    .stroke();
  doc
    .font(fonts.regular)
    .fontSize(8)
    .fillColor(C.muted)
    .text("Page 1 of 1", M, footerRuleY + 8, { width: CW, align: "right" });

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}
