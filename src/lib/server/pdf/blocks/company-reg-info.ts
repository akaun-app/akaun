import type PDFDocument from 'pdfkit';
import type { BlockDef, ThemeData } from '../template-types.js';
import { C } from '../layout.js';

type Bounds = { x: number; y: number; width: number };
type Fonts = { regular: string; bold: string };

export function render(
	doc: InstanceType<typeof PDFDocument>,
	block: BlockDef,
	data: { settings?: { companyRegistrationNo?: string } },
	_theme: ThemeData,
	{ x, y, width }: Bounds,
	fonts: Fonts
): number {
	const reg = data.settings?.companyRegistrationNo;
	if (!reg) return y;
	const align = (block.style?.align ?? 'left') as 'left' | 'center' | 'right';
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(doc as any).font(fonts.regular).fontSize(9).fillColor(C.muted).text('Reg. No: ' + reg, x, y, { width, align });
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return (doc as any).y;
}
