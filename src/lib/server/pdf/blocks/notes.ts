import type PDFDocument from 'pdfkit';
import type { BlockDef, ThemeData } from '../template-types.js';
import { C } from '../layout.js';

type Bounds = { x: number; y: number; width: number };
type Fonts = { regular: string; bold: string };

export function render(
	doc: InstanceType<typeof PDFDocument>,
	block: BlockDef,
	data: { document: { notes?: string | null } },
	_theme: ThemeData,
	{ x, y, width }: Bounds,
	fonts: Fonts
): number {
	const notes = data.document.notes;
	if (!notes) return y;
	const cfg = block.config as { label?: string };
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const d = doc as any;
	d.font(fonts.bold).fontSize(8).fillColor(C.muted).text(cfg.label ?? 'Notes', x, y, { width });
	y = d.y + 3;
	d.font(fonts.regular).fontSize(9).fillColor(C.dark).text(notes, x, y, { width });
	return d.y;
}
