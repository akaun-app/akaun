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
	fonts: Fonts
): number {
	const cfg = block.config as { title?: string; body?: string; fontSize?: number };
	const mt = (block.style?.marginTop ?? 0) * PT_PER_MM;
	const mb = (block.style?.marginBottom ?? 0) * PT_PER_MM;
	const align = (block.style?.align ?? 'left') as 'left' | 'center' | 'right';
	y += mt;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const d = doc as any;
	if (cfg.title) {
		d.font(fonts.bold).fontSize(10).fillColor(C.dark).text(cfg.title, x, y, { width, align });
		y = d.y + 3;
	}
	if (cfg.body) {
		d.font(fonts.regular)
			.fontSize(cfg.fontSize ?? 9)
			.fillColor(C.subtle)
			.text(cfg.body, x, y, { width, align });
		y = d.y;
	}
	return y + mb;
}
