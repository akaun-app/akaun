import type PDFDocument from 'pdfkit';
import type { BlockDef, ThemeData } from '../template-types.js';
import { PT_PER_MM, C } from '../layout.js';

type Bounds = { x: number; y: number; width: number };
type Fonts = { regular: string; bold: string };

export function render(
	doc: InstanceType<typeof PDFDocument>,
	block: BlockDef,
	_data: unknown,
	_theme: ThemeData,
	{ x, y, width }: Bounds,
	_fonts: Fonts
): number {
	const cfg = block.config as { color?: string; thickness?: number };
	const mt = (block.style?.marginTop ?? 2) * PT_PER_MM;
	const mb = (block.style?.marginBottom ?? 2) * PT_PER_MM;
	const thickness = cfg.thickness ?? 0.5;
	y += mt;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(doc as any)
		.moveTo(x, y)
		.lineTo(x + width, y)
		.strokeColor(cfg.color ?? C.light)
		.lineWidth(thickness)
		.stroke();
	return y + thickness + mb;
}
