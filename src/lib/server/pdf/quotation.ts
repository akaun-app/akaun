import PDFDocument from 'pdfkit';
import type { getQuotation } from '../queries/quotations.js';
import { M, CW, COL_DESC, COL_QTY, COL_PRICE, COL_TOTAL, TX_QTY, TX_PRICE, TX_TOTAL, C, fmt, fmtDate } from './layout.js';

type Quotation = NonNullable<ReturnType<typeof getQuotation>>;
type Settings = { companyName: string; companyAddress: string; companyRegistrationNo: string };

export function buildQuotationPdf(quotation: Quotation, settings: Settings): Promise<Buffer> {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const doc = new (PDFDocument as any)({ size: 'A4', margin: 0, info: { Title: quotation.quotationNumber } });

	let y = M;

	// ── HEADER ───────────────────────────────────────────────────────────────────
	const companyName = settings.companyName || 'Akaun';
	const rightX = M + CW / 2;
	const rightW = CW / 2;

	// Company block (left side)
	doc.font('Helvetica-Bold').fontSize(20).fillColor(C.dark)
		.text(companyName, M, y, { width: CW / 2 });
	let companyBottomY = doc.y;

	if (settings.companyAddress) {
		doc.font('Helvetica').fontSize(10).fillColor(C.subtle)
			.text(settings.companyAddress, M, companyBottomY + 4, { width: CW / 2 });
		companyBottomY = doc.y;
	}
	if (settings.companyRegistrationNo) {
		doc.font('Helvetica').fontSize(9).fillColor(C.muted)
			.text('Reg. No: ' + settings.companyRegistrationNo, M, companyBottomY + 4, { width: CW / 2 });
		companyBottomY = doc.y;
	}

	// Doc meta (right side)
	doc.font('Helvetica-Bold').fontSize(9).fillColor(C.muted)
		.text('QUOTATION', rightX, y, { width: rightW, align: 'right', characterSpacing: 1 });
	doc.font('Helvetica-Bold').fontSize(18).fillColor(C.dark)
		.text(quotation.quotationNumber, rightX, y + 14, { width: rightW, align: 'right' });
	const metaBottomY = y + 14 + 24;

	// Thick rule below header
	const ruleY = Math.max(companyBottomY, metaBottomY) + 12;
	doc.moveTo(M, ruleY).lineTo(M + CW, ruleY).lineWidth(2).strokeColor(C.dark).stroke();

	y = ruleY + 24;

	// ── INFO SECTION ─────────────────────────────────────────────────────────────
	const infoStartY = y;
	let leftY = infoStartY;

	if (quotation.contactName) {
		doc.font('Helvetica-Bold').fontSize(8).fillColor(C.muted)
			.text('BILL TO', M, leftY, { width: CW / 2, characterSpacing: 0.5 });
		const labelEnd = doc.y;
		doc.font('Helvetica').fontSize(11).fillColor(C.dark)
			.text(quotation.contactName, M, labelEnd + 2, { width: CW / 2 });
		leftY = doc.y;
	}

	let rightY = infoStartY;
	const infoItems: [string, string][] = [['ISSUE DATE', fmtDate(quotation.issueDate)]];
	if (quotation.expiryDate) infoItems.push(['VALID UNTIL', fmtDate(quotation.expiryDate)]);
	if (quotation.reference) infoItems.push(['REFERENCE', quotation.reference]);
	infoItems.push(['CURRENCY', quotation.currency]);

	for (const [label, value] of infoItems) {
		doc.font('Helvetica-Bold').fontSize(8).fillColor(C.muted)
			.text(label, rightX, rightY, { width: rightW, align: 'right', characterSpacing: 0.5 });
		const labelEnd = doc.y;
		doc.font('Helvetica').fontSize(11).fillColor(C.dark)
			.text(value, rightX, labelEnd + 2, { width: rightW, align: 'right' });
		rightY = doc.y + 10;
	}

	y = Math.max(leftY, rightY) + 24;

	// ── LINE ITEMS TABLE ──────────────────────────────────────────────────────────
	doc.font('Helvetica-Bold').fontSize(8).fillColor(C.muted);
	doc.text('DESCRIPTION', M, y, { width: COL_DESC, characterSpacing: 0.5 });
	doc.text('QTY', TX_QTY, y, { width: COL_QTY, align: 'center', characterSpacing: 0.5 });
	doc.text('UNIT PRICE', TX_PRICE, y, { width: COL_PRICE, align: 'right', characterSpacing: 0.5 });
	doc.text('TOTAL', TX_TOTAL, y, { width: COL_TOTAL, align: 'right', characterSpacing: 0.5 });

	y += 14;
	doc.moveTo(M, y).lineTo(M + CW, y).lineWidth(0.5).strokeColor(C.light).stroke();
	y += 8;

	for (const line of quotation.lines) {
		const rowY = y;
		doc.font('Helvetica').fontSize(10).fillColor(C.body)
			.text(line.description, M, rowY, { width: COL_DESC });
		const rowEndY = doc.y;

		doc.font('Helvetica').fontSize(10).fillColor(C.body)
			.text(String(line.quantity), TX_QTY, rowY, { width: COL_QTY, align: 'center' });
		doc.font('Helvetica').fontSize(10).fillColor(C.body)
			.text(fmt(line.unitPrice), TX_PRICE, rowY, { width: COL_PRICE, align: 'right' });
		doc.font('Helvetica').fontSize(10).fillColor(C.body)
			.text(fmt(line.lineTotal), TX_TOTAL, rowY, { width: COL_TOTAL, align: 'right' });

		y = Math.max(rowEndY, rowY + 14) + 6;
		doc.moveTo(M, y).lineTo(M + CW, y).lineWidth(0.5).strokeColor(C.light).stroke();
		y += 8;
	}

	// ── TOTALS FOOTER ─────────────────────────────────────────────────────────────
	y += 2;
	const footerLabelWidth = TX_TOTAL - M;

	doc.font('Helvetica').fontSize(10).fillColor(C.muted)
		.text('Subtotal', M, y, { width: footerLabelWidth, align: 'right' });
	doc.font('Helvetica').fontSize(10).fillColor(C.muted)
		.text(fmt(quotation.subtotal), TX_TOTAL, y, { width: COL_TOTAL, align: 'right' });
	y += 18;

	doc.font('Helvetica').fontSize(10).fillColor(C.muted)
		.text('Tax', M, y, { width: footerLabelWidth, align: 'right' });
	doc.font('Helvetica').fontSize(10).fillColor(C.muted)
		.text(fmt(quotation.taxAmount), TX_TOTAL, y, { width: COL_TOTAL, align: 'right' });
	y += 14;

	// Thick rule before total
	doc.moveTo(M, y).lineTo(M + CW, y).lineWidth(2).strokeColor(C.dark).stroke();
	y += 8;

	doc.font('Helvetica-Bold').fontSize(10).fillColor(C.dark)
		.text(`Total (${quotation.currency})`, M, y, { width: footerLabelWidth, align: 'right' });
	doc.font('Helvetica-Bold').fontSize(13).fillColor(C.dark)
		.text(fmt(quotation.total), TX_TOTAL, y, { width: COL_TOTAL, align: 'right' });
	y = doc.y + 20;

	// ── NOTES ──────────────────────────────────────────────────────────────────────
	if (quotation.notes) {
		doc.moveTo(M, y).lineTo(M + CW, y).lineWidth(0.5).strokeColor(C.light).stroke();
		y += 16;
		doc.font('Helvetica-Bold').fontSize(8).fillColor(C.muted)
			.text('NOTES', M, y, { characterSpacing: 0.5 });
		y = doc.y + 4;
		doc.font('Helvetica').fontSize(10).fillColor('#333333')
			.text(quotation.notes, M, y, { width: CW });
		y = doc.y + 24;
	}

	// ── TERMS ──────────────────────────────────────────────────────────────────────
	if (quotation.terms) {
		doc.moveTo(M, y).lineTo(M + CW, y).lineWidth(0.5).strokeColor(C.light).stroke();
		y += 16;
		doc.font('Helvetica-Bold').fontSize(8).fillColor(C.muted)
			.text('TERMS & CONDITIONS', M, y, { characterSpacing: 0.5 });
		y = doc.y + 4;
		doc.font('Helvetica').fontSize(10).fillColor('#333333')
			.text(quotation.terms, M, y, { width: CW });
	}

	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		doc.on('data', (chunk: Buffer) => chunks.push(chunk));
		doc.on('end', () => resolve(Buffer.concat(chunks)));
		doc.on('error', reject);
		doc.end();
	});
}
