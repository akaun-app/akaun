import type PDFDocument from 'pdfkit';
import type { ColumnDef, ThemeData } from './template-types.js';
import { renderBlock } from './renderer.js';

type Fonts = { regular: string; bold: string };
type Bounds = { x: number; y: number; width: number };

/**
 * Render a list of columns side-by-side.
 * Each column gets its proportional slice of `bounds.width`.
 * Returns the bottom Y of the tallest column.
 */
export function renderColumns(
	doc: InstanceType<typeof PDFDocument>,
	columns: ColumnDef[],
	data: unknown,
	theme: ThemeData,
	{ x, y, width }: Bounds,
	fonts: Fonts,
	gap = 16
): number {
	if (columns.length === 0) return y;

	const totalGap = gap * (columns.length - 1);
	const usableW = width - totalGap;
	const bottoms: number[] = [];

	let curX = x;
	for (const col of columns) {
		const colW = (col.width / 100) * usableW;
		let colY = y;
		for (const block of col.blocks) {
			colY = renderBlock(doc, block, data, theme, { x: curX, y: colY, width: colW }, fonts);
		}
		bottoms.push(colY);
		curX += colW + gap;
	}

	return Math.max(y, ...bottoms);
}
