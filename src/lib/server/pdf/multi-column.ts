import type PDFDocument from 'pdfkit';
import type { BlockDef, ThemeData } from './template-types.js';
import { renderBlock } from './renderer.js';

type Fonts = { regular: string; bold: string };
type Bounds = { x: number; y: number; width: number };

/**
 * Render a list of blocks side-by-side in a horizontal row.
 * All items (including spacers) share equal width. Spacer blocks advance x
 * without rendering any content, pushing adjacent blocks apart.
 * Returns the bottom Y of the tallest rendered block.
 */
export function renderRow(
	doc: InstanceType<typeof PDFDocument>,
	blocks: BlockDef[],
	data: unknown,
	theme: ThemeData,
	{ x, y, width }: Bounds,
	fonts: Fonts,
	gap = 16
): number {
	if (blocks.length === 0) return y;

	const totalGap = gap * (blocks.length - 1);
	const itemW = (width - totalGap) / blocks.length;
	let curX = x;
	let maxY = y;

	for (const block of blocks) {
		if (block.type !== 'spacer') {
			const bottom = renderBlock(doc, block, data, theme, { x: curX, y, width: itemW }, fonts);
			maxY = Math.max(maxY, bottom);
		}
		curX += itemW + gap;
	}

	return maxY;
}
