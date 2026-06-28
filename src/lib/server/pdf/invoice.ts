import PDFDocument from 'pdfkit';
import type { getInvoice } from '../queries/invoices.js';
import { M, CW, COL_DESC, COL_QTY, COL_PRICE, COL_TOTAL, TX_QTY, TX_PRICE, TX_TOTAL, C, fmt, fmtDate } from './layout.js';

type Invoice = NonNullable<ReturnType<typeof getInvoice>>;
type Settings = { companyName: string; companyAddress: string; companyRegistrationNo: string };

export function buildInvoicePdf(invoice: Invoice, settings: Settings): Promise<Buffer> {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const doc = new (PDFDocument as any)({ size: 'A4', margin: 0, info: { Title: invoice.invoiceNumber } });

	const today = new Date().toISOString().slice(0, 10);
	const isOverdue = !!invoice.dueDate && invoice.dueDate < today && invoice.isOverdue;

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
			.text('Reg No: ' + settings.companyRegistrationNo, M, companyBottomY + 4, { width: CW / 2 });
		companyBottomY = doc.y;
	}

	// Doc meta (right side)
	doc.font('Helvetica-Bold').fontSize(9).fillColor(C.muted)
		.text('INVOICE', rightX, y, { width: rightW, align: 'right', characterSpacing: 1 });
	doc.font('Helvetica-Bold').fontSize(18).fillColor(C.dark)
		.text(invoice.invoiceNumber, rightX, y + 14, { width: rightW, align: 'right' });
	const metaBottomY = y + 14 + 24;

	// Thick rule below header
	const ruleY = Math.max(companyBottomY, metaBottomY) + 12;
	doc.moveTo(M, ruleY).lineTo(M + CW, ruleY).lineWidth(2).strokeColor(C.dark).stroke();

	y = ruleY + 24;

	// ── INFO SECTION ─────────────────────────────────────────────────────────────
	const infoStartY = y;
	let leftY = infoStartY;

	if (invoice.contactName) {
		doc.font('Helvetica-Bold').fontSize(8).fillColor(C.muted)
			.text('BILL TO', M, leftY, { width: CW / 2, characterSpacing: 0.5 });
		const labelEnd = doc.y;
		doc.font('Helvetica').fontSize(11).fillColor(C.dark)
			.text(invoice.contactName, M, labelEnd + 2, { width: CW / 2 });
		leftY = doc.y;
	}

	let rightY = infoStartY;
	const infoItems: Array<[string, string, boolean?]> = [
		['ISSUE DATE', fmtDate(invoice.issueDate)]
	];
	if (invoice.dueDate) {
		infoItems.push(['DUE DATE', fmtDate(invoice.dueDate), isOverdue]);
	}
	if (invoice.reference) infoItems.push(['REFERENCE', invoice.reference]);
	infoItems.push(['CURRENCY', invoice.currency]);

	for (const [label, value, overdue] of infoItems) {
		doc.font('Helvetica-Bold').fontSize(8).fillColor(C.muted)
			.text(label, rightX, rightY, { width: rightW, align: 'right', characterSpacing: 0.5 });
		const labelEnd = doc.y;
		const valueColor = overdue ? C.red : C.dark;
		doc.font(overdue ? 'Helvetica-Bold' : 'Helvetica').fontSize(11).fillColor(valueColor)
			.text(value + (overdue ? ' — OVERDUE' : ''), rightX, labelEnd + 2, { width: rightW, align: 'right' });
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

	for (const line of invoice.lines) {
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
		.text(fmt(invoice.subtotal), TX_TOTAL, y, { width: COL_TOTAL, align: 'right' });
	y += 18;

	doc.font('Helvetica').fontSize(10).fillColor(C.muted)
		.text('Tax', M, y, { width: footerLabelWidth, align: 'right' });
	doc.font('Helvetica').fontSize(10).fillColor(C.muted)
		.text(fmt(invoice.taxAmount), TX_TOTAL, y, { width: COL_TOTAL, align: 'right' });
	y += 14;

	// Thick rule before total
	doc.moveTo(M, y).lineTo(M + CW, y).lineWidth(2).strokeColor(C.dark).stroke();
	y += 8;

	doc.font('Helvetica-Bold').fontSize(10).fillColor(C.dark)
		.text(`Total (${invoice.currency})`, M, y, { width: footerLabelWidth, align: 'right' });
	doc.font('Helvetica-Bold').fontSize(13).fillColor(C.dark)
		.text(fmt(invoice.total), TX_TOTAL, y, { width: COL_TOTAL, align: 'right' });
	y = doc.y + 16;

	// ── AMOUNT PAID ───────────────────────────────────────────────────────────────
	if (invoice.amountPaid > 0) {
		// Green tinted box
		doc.roundedRect(M, y, CW, 38, 4).fill('#f0fdf4');
		doc.moveTo(M, y).lineTo(M + CW, y).lineWidth(0.5).strokeColor('#bbf7d0').stroke();
		doc.moveTo(M, y + 38).lineTo(M + CW, y + 38).lineWidth(0.5).strokeColor('#bbf7d0').stroke();

		doc.font('Helvetica-Bold').fontSize(8).fillColor(C.green)
			.text('PAYMENT', M + 12, y + 8, { characterSpacing: 0.5 });
		doc.font('Helvetica-Bold').fontSize(10).fillColor(C.green)
			.text(`Amount Paid: ${invoice.currency} ${fmt(invoice.amountPaid)}`, M + 12, y + 20);
		y += 52;
	}

	// ── NOTES ──────────────────────────────────────────────────────────────────────
	if (invoice.notes) {
		doc.moveTo(M, y).lineTo(M + CW, y).lineWidth(0.5).strokeColor(C.light).stroke();
		y += 16;
		doc.font('Helvetica-Bold').fontSize(8).fillColor(C.muted)
			.text('NOTES', M, y, { characterSpacing: 0.5 });
		y = doc.y + 4;
		doc.font('Helvetica').fontSize(10).fillColor('#333333')
			.text(invoice.notes, M, y, { width: CW });
		y = doc.y + 24;
	}

	// ── TERMS ──────────────────────────────────────────────────────────────────────
	if (invoice.terms) {
		doc.moveTo(M, y).lineTo(M + CW, y).lineWidth(0.5).strokeColor(C.light).stroke();
		y += 16;
		doc.font('Helvetica-Bold').fontSize(8).fillColor(C.muted)
			.text('TERMS & CONDITIONS', M, y, { characterSpacing: 0.5 });
		y = doc.y + 4;
		doc.font('Helvetica').fontSize(10).fillColor('#333333')
			.text(invoice.terms, M, y, { width: CW });
	}

	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		doc.on('data', (chunk: Buffer) => chunks.push(chunk));
		doc.on('end', () => resolve(Buffer.concat(chunks)));
		doc.on('error', reject);
		doc.end();
	});
}
