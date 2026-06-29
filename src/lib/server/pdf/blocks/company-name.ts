import type PDFDocument from 'pdfkit';
import type { BlockDef, ThemeData } from '../template-types.js';
import { C } from '../layout.js';

type Bounds = { x: number; y: number; width: number };
type Fonts = { regular: string; bold: string };

export function render(
	doc: InstanceType<typeof PDFDocument>,
	block: BlockDef,
	data: { settings?: { companyName?: string } },
	_theme: ThemeData,
	{ x, y, width }: Bounds,
	fonts: Fonts
): number {
	const align = (block.style?.align ?? 'left') as 'left' | 'center' | 'right';
	const name = data.settings?.companyName || 'Company';
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(doc as any).font(fonts.bold).fontSize(20).fillColor(C.dark).text(name, x, y, { width, align });
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return (doc as any).y;
}
