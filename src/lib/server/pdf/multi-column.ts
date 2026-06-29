import type PDFDocument from 'pdfkit';
import type { GridCell, ThemeData } from './template-types.js';
import { renderBlock } from './renderer.js';

type Fonts = { regular: string; bold: string };

/**
 * Render a flat grid of placed cells via a column-bottom sweep.
 *
 * Each column tracks its current bottom Y. Cells are processed top-to-bottom,
 * left-to-right; a cell starts at the lowest free Y across the columns it spans,
 * and after rendering it pushes every spanned column's bottom down. This yields
 * the row-span-beside-stacked-cells behaviour without explicit height math, and
 * never overlaps content. Returns the bottom Y of the tallest column.
 *
 * Spacer cells advance nothing visually — they just reserve their grid columns
 * (leaving that lane untouched), acting as deliberate empty gaps.
 */
export function renderGrid(
	doc: InstanceType<typeof PDFDocument>,
	cells: GridCell[],
	columns: number,
	data: unknown,
	theme: ThemeData,
	{ x, y, width }: { x: number; y: number; width: number },
	fonts: Fonts,
	gap = 16
): number {
	const colW = width / columns;
	const colBottom = new Array<number>(columns).fill(y);

	// Stable sort by (row, col) so the sweep is deterministic.
	const ordered = [...cells].sort((a, b) => a.row - b.row || a.col - b.col);

	for (const cell of ordered) {
		const col = Math.min(Math.max(cell.col, 0), columns - 1);
		const span = Math.min(Math.max(cell.colSpan, 1), columns - col);

		// Top is the lowest current bottom across the spanned columns.
		let top = colBottom[col];
		for (let c = col; c < col + span; c++) top = Math.max(top, colBottom[c]);

		if (cell.type !== 'spacer') {
			const cellX = x + col * colW;
			const cellW = span * colW - gap;
			const bottom = renderBlock(doc, cell, data, theme, { x: cellX, y: top, width: cellW }, fonts);
			for (let c = col; c < col + span; c++) colBottom[c] = bottom + gap;
		} else {
			// Reserve the lane so neighbours flow correctly, but add no content.
			for (let c = col; c < col + span; c++) colBottom[c] = top + gap;
		}
	}

	return Math.max(y, ...colBottom);
}
