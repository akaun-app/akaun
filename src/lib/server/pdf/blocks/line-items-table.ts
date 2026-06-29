import type PDFDocument from 'pdfkit';
import type { BlockDef, ThemeData } from '../template-types.js';
import { PT_PER_MM, COL_DESC, COL_QTY, COL_PRICE, COL_TOTAL, TX_QTY, TX_PRICE, TX_TOTAL, C, fmt } from '../layout.js';

type Bounds = { x: number; y: number; width: number };
type Fonts = { regular: string; bold: string };
type LineItem = { description: string; quantity: number; unitPrice: number; lineTotal: number };
type RenderData = { document: { lines: LineItem[] } };

export function render(
	doc: InstanceType<typeof PDFDocument>,
	block: BlockDef,
	data: RenderData,
	_theme: ThemeData,
	{ x, y }: Bounds,
	fonts: Fonts
): number {
	const cfg = block.config as { showUnitPrice?: boolean; showQty?: boolean };
	const mt = (block.style?.marginTop ?? 4) * PT_PER_MM;
	const mb = (block.style?.marginBottom ?? 0) * PT_PER_MM;
	y += mt;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const d = doc as any;

	// Header row — use the original table column positions based on page left margin,
	// not on the block's `x` which may differ in multi-column mode.
	// For now we use the canonical positions from layout.ts (anchored to page M).
	const qtyX = x + COL_DESC;
	const priceX = qtyX + COL_QTY;
	const totalX = priceX + COL_PRICE;

	d.font(fonts.bold).fontSize(8).fillColor(C.muted);
	d.text('DESCRIPTION', x, y, { width: COL_DESC, characterSpacing: 0.5 });
	if (cfg.showQty !== false) {
		d.text('QTY', qtyX, y, { width: COL_QTY, align: 'center', characterSpacing: 0.5 });
	}
	if (cfg.showUnitPrice !== false) {
		d.text('UNIT PRICE', priceX, y, { width: COL_PRICE, align: 'right', characterSpacing: 0.5 });
	}
	d.text('TOTAL', totalX, y, { width: COL_TOTAL, align: 'right', characterSpacing: 0.5 });

	y += 14;
	d.moveTo(x, y).lineTo(x + COL_DESC + COL_QTY + COL_PRICE + COL_TOTAL, y)
		.lineWidth(0.5).strokeColor(C.light).stroke();
	y += 8;

	for (const line of data.document.lines) {
		const rowY = y;
		d.font(fonts.regular).fontSize(10).fillColor(C.body)
			.text(line.description, x, rowY, { width: COL_DESC });
		const rowEndY = d.y;

		if (cfg.showQty !== false) {
			d.font(fonts.regular).fontSize(10).fillColor(C.body)
				.text(String(line.quantity), qtyX, rowY, { width: COL_QTY, align: 'center' });
		}
		if (cfg.showUnitPrice !== false) {
			d.font(fonts.regular).fontSize(10).fillColor(C.body)
				.text(fmt(line.unitPrice), priceX, rowY, { width: COL_PRICE, align: 'right' });
		}
		d.font(fonts.regular).fontSize(10).fillColor(C.body)
			.text(fmt(line.lineTotal), totalX, rowY, { width: COL_TOTAL, align: 'right' });

		y = Math.max(rowEndY, rowY + 14) + 6;
		d.moveTo(x, y).lineTo(x + COL_DESC + COL_QTY + COL_PRICE + COL_TOTAL, y)
			.lineWidth(0.5).strokeColor(C.light).stroke();
		y += 8;
	}
	return y + mb;
}

// Re-export layout constants for use in totals-block
export { COL_DESC, COL_QTY, COL_PRICE, COL_TOTAL, TX_QTY, TX_PRICE, TX_TOTAL };
