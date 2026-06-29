import type PDFDocument from 'pdfkit';
import type { BlockDef, ThemeData } from '../template-types.js';
import { PT_PER_MM, COL_DESC, COL_QTY, COL_PRICE, COL_TOTAL, C, fmt } from '../layout.js';

type Bounds = { x: number; y: number; width: number };
type Fonts = { regular: string; bold: string };
type RenderData = {
	document: {
		subtotal: number;
		taxAmount: number;
		total: number;
		currency: string;
	};
};

export function render(
	doc: InstanceType<typeof PDFDocument>,
	block: BlockDef,
	data: RenderData,
	_theme: ThemeData,
	{ x, y }: Bounds,
	fonts: Fonts
): number {
	const cfg = block.config as { showTaxRow?: boolean };
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const d = doc as any;
	const totalX = x + COL_DESC + COL_QTY + COL_PRICE;
	const labelWidth = totalX - x;
	const { subtotal, taxAmount, total, currency } = data.document;

	d.font(fonts.regular).fontSize(10).fillColor(C.muted)
		.text('Subtotal', x, y, { width: labelWidth, align: 'right' });
	d.font(fonts.regular).fontSize(10).fillColor(C.muted)
		.text(fmt(subtotal), totalX, y, { width: COL_TOTAL, align: 'right' });
	y += 18;

	if (cfg.showTaxRow !== false) {
		d.font(fonts.regular).fontSize(10).fillColor(C.muted)
			.text('Tax', x, y, { width: labelWidth, align: 'right' });
		d.font(fonts.regular).fontSize(10).fillColor(C.muted)
			.text(fmt(taxAmount), totalX, y, { width: COL_TOTAL, align: 'right' });
		y += 14;
	}

	d.moveTo(x, y).lineTo(x + COL_DESC + COL_QTY + COL_PRICE + COL_TOTAL, y)
		.lineWidth(2).strokeColor(C.dark).stroke();
	y += 8;

	d.font(fonts.bold).fontSize(10).fillColor(C.dark)
		.text(`Total (${currency})`, x, y, { width: labelWidth, align: 'right' });
	d.font(fonts.bold).fontSize(13).fillColor(C.dark)
		.text(fmt(total), totalX, y, { width: COL_TOTAL, align: 'right' });
	y = d.y + 20;

	return y;
}
