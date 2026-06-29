import type PDFDocument from 'pdfkit';
import type { BlockDef, ThemeData } from '../template-types.js';
import { PT_PER_MM, C, fmtDate } from '../layout.js';

type Bounds = { x: number; y: number; width: number };
type Fonts = { regular: string; bold: string };
type RenderData = {
	document: {
		quotationNumber?: string;
		invoiceNumber?: string;
		issueDate?: string | null;
		expiryDate?: string | null;
		dueDate?: string | null;
		reference?: string | null;
		currency?: string;
	};
	docTypeLabel: string; // 'QUOTATION' or 'INVOICE'
};

export function render(
	doc: InstanceType<typeof PDFDocument>,
	block: BlockDef,
	data: RenderData,
	_theme: ThemeData,
	{ x, y, width }: Bounds,
	fonts: Fonts
): number {
	const cfg = block.config as { showReference?: boolean };
	const mt = (block.style?.marginTop ?? 0) * PT_PER_MM;
	const mb = (block.style?.marginBottom ?? 0) * PT_PER_MM;
	const align = 'right';
	y += mt;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const d = doc as any;
	const docNumber =
		data.document.quotationNumber ?? data.document.invoiceNumber ?? '';

	d.font(fonts.bold).fontSize(9).fillColor(C.muted)
		.text(data.docTypeLabel, x, y, { width, align, characterSpacing: 1 });
	d.font(fonts.bold).fontSize(18).fillColor(C.dark)
		.text(docNumber, x, y + 14, { width, align });
	y += 14 + 24;

	const metaItems: [string, string][] = [
		['ISSUE DATE', fmtDate(data.document.issueDate)]
	];
	if (data.document.expiryDate) metaItems.push(['VALID UNTIL', fmtDate(data.document.expiryDate)]);
	if (data.document.dueDate) metaItems.push(['DUE DATE', fmtDate(data.document.dueDate)]);
	if (cfg.showReference !== false && data.document.reference) {
		metaItems.push(['REFERENCE', data.document.reference]);
	}
	if (data.document.currency) metaItems.push(['CURRENCY', data.document.currency]);

	for (const [label, value] of metaItems) {
		d.font(fonts.bold).fontSize(8).fillColor(C.muted)
			.text(label, x, y, { width, align, characterSpacing: 0.5 });
		const labelEnd = d.y;
		d.font(fonts.regular).fontSize(11).fillColor(C.dark)
			.text(value, x, labelEnd + 2, { width, align });
		y = d.y + 10;
	}
	return y + mb;
}
