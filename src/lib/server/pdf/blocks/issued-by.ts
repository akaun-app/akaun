import type PDFDocument from 'pdfkit';
import type { BlockDef, ThemeData } from '../template-types.js';
import { PT_PER_MM, C } from '../layout.js';

type Bounds = { x: number; y: number; width: number };
type Fonts = { regular: string; bold: string };
type RenderData = {
	document: { createdByName?: string | null };
};

export function render(
	doc: InstanceType<typeof PDFDocument>,
	block: BlockDef,
	data: RenderData,
	_theme: ThemeData,
	{ x, y, width }: Bounds,
	fonts: Fonts
): number {
	const cfg = block.config as { label?: string };
	const mt = (block.style?.marginTop ?? 4) * PT_PER_MM;
	const mb = (block.style?.marginBottom ?? 0) * PT_PER_MM;
	y += mt;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const d = doc as any;
	const label = cfg.label ?? 'Issued by';
	const value = data.document.createdByName ?? '';
	d.font(fonts.bold).fontSize(8).fillColor(C.muted).text(label, x, y, { width, characterSpacing: 0.5 });
	y = d.y + 2;
	d.font(fonts.regular).fontSize(10).fillColor(C.dark).text(value, x, y, { width });
	y = d.y;
	return y + mb;
}
