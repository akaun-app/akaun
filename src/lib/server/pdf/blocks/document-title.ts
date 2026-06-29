import type PDFDocument from 'pdfkit';
import type { BlockDef, ThemeData } from '../template-types.js';
import { C } from '../layout.js';

type Bounds = { x: number; y: number; width: number };
type Fonts = { regular: string; bold: string };

export function render(
	doc: InstanceType<typeof PDFDocument>,
	block: BlockDef,
	data: { docTypeLabel?: string },
	_theme: ThemeData,
	{ x, y, width }: Bounds,
	fonts: Fonts
): number {
	const align = (block.style?.align ?? 'right') as 'left' | 'center' | 'right';
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(doc as any).font(fonts.bold).fontSize(9).fillColor(C.muted)
		.text(data.docTypeLabel ?? '', x, y, { width, align, characterSpacing: 1 });
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return (doc as any).y;
}
