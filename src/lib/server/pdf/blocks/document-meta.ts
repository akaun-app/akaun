import type PDFDocument from 'pdfkit';
import type { BlockDef, ThemeData } from '../template-types.js';
import { C, fmtDate } from '../layout.js';

type Bounds = { x: number; y: number; width: number };
type Fonts = { regular: string; bold: string };
type RenderData = {
	document: {
		quotationNumber?: string;
		invoiceNumber?: string;
		issueDate?: string | null;
		expiryDate?: string | null;
		dueDate?: string | null;
		currency?: string;
	};
};

const LABEL_W = 72;

export function render(
	doc: InstanceType<typeof PDFDocument>,
	block: BlockDef,
	data: RenderData,
	_theme: ThemeData,
	{ x, y, width }: Bounds,
	fonts: Fonts
): number {
	const align = (block.style?.align ?? 'right') as 'left' | 'center' | 'right';
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const d = doc as any;
	const docNumber = data.document.quotationNumber ?? data.document.invoiceNumber ?? '';

	const rows: [string, string][] = [
		['No.', docNumber],
		['Date', fmtDate(data.document.issueDate)]
	];
	if (data.document.expiryDate) rows.push(['Valid Until', fmtDate(data.document.expiryDate)]);
	if (data.document.dueDate) rows.push(['Due Date', fmtDate(data.document.dueDate)]);
	if (data.document.currency) rows.push(['Currency', data.document.currency]);

	// Shift the whole content block for block-level alignment.
	// Labels stay left-aligned within the label column; only the starting x shifts.
	let startX = x;
	if (align !== 'left') {
		d.font(fonts.regular).fontSize(9);
		const maxValueW = Math.max(...rows.map(([, v]) => d.widthOfString(' : ' + (v || '—'))));
		const contentW = Math.min(LABEL_W + maxValueW, width);
		startX = align === 'right' ? x + width - contentW : x + (width - contentW) / 2;
		startX = Math.max(x, startX);
	}
	const valueW = width - (startX - x) - LABEL_W;

	for (const [label, value] of rows) {
		const rowY = y;
		d.font(fonts.regular).fontSize(9).fillColor(C.dark)
			.text(label, startX, rowY, { width: LABEL_W });
		const labelEndY = d.y;
		d.font(fonts.regular).fontSize(9).fillColor(C.dark)
			.text(' : ' + (value || '—'), startX + LABEL_W, rowY, { width: valueW });
		y = Math.max(labelEndY, d.y) + 3;
	}

	return y;
}
