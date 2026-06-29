import type PDFDocument from 'pdfkit';
import type { BlockDef, ThemeData } from '../template-types.js';
import { PT_PER_MM } from '../layout.js';

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
	const mt = (block.style?.marginTop ?? 0) * PT_PER_MM;
	const mb = (block.style?.marginBottom ?? 0) * PT_PER_MM;
	return y + mt + (cfg.height ?? 20) + mb;
}
