import type PDFDocument from 'pdfkit';
import type { BlockDef, ThemeData } from '../template-types.js';
import { PT_PER_MM, C } from '../layout.js';

type Bounds = { x: number; y: number; width: number };
type Fonts = { regular: string; bold: string };
type RenderData = {
	document: {
		paidAt?: string | null; // ISO date; if null/undefined the stamp is not shown
	};
};

export function render(
	doc: InstanceType<typeof PDFDocument>,
	_block: BlockDef,
	data: RenderData,
	theme: ThemeData,
	{ x, y, width }: Bounds,
	fonts: Fonts
): number {
	if (!data.document.paidAt) return y;
	const mb = ((_block.style?.marginBottom ?? 0)) * PT_PER_MM;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const d = doc as any;
	const stampW = 100;
	const stampH = 36;
	const stampX = x + width - stampW;
	d.roundedRect(stampX, y, stampW, stampH, 4)
		.strokeColor(theme.color)
		.lineWidth(2)
		.stroke();
	d.font(fonts.bold).fontSize(14).fillColor(theme.color)
		.text('PAID', stampX, y + 10, { width: stampW, align: 'center' });
	y += stampH + mb;
	return y;
}
