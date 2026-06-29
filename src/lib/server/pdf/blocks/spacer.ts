import type PDFDocument from 'pdfkit';
import type { BlockDef, ThemeData } from '../template-types.js';

type Bounds = { x: number; y: number; width: number };
type Fonts = { regular: string; bold: string };

export function render(
	_doc: InstanceType<typeof PDFDocument>,
	block: BlockDef,
	_data: unknown,
	_theme: ThemeData,
	{ y }: Bounds,
	_fonts: Fonts
): number {
	const cfg = block.config as { height?: number };
	return y + (cfg.height ?? 20);
}
