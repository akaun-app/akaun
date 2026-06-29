import type PDFDocument from 'pdfkit';
import type { BlockDef, ThemeData } from '../template-types.js';
import { C } from '../layout.js';

type Bounds = { x: number; y: number; width: number };
type Fonts = { regular: string; bold: string };
type RenderData = {
	document: {
		contactName?: string | null;
		contactAddress?: string | null;
		contactRegistrationNo?: string | null;
		contactPhone?: string | null;
	};
};

const LABEL_W = 72;

export function render(
	doc: InstanceType<typeof PDFDocument>,
	block: BlockDef,
	data: RenderData,
	_theme: ThemeData,
	{ x, y, width }: Bounds,
	fonts: Fonts
): number {
	const { contactName, contactAddress, contactRegistrationNo, contactPhone } = data.document;
	if (!contactName && !contactAddress) return y;
	const align = (block.style?.align ?? 'left') as 'left' | 'center' | 'right';
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const d = doc as any;

	const rows: [string, string][] = [];
	if (contactName) rows.push(['Bill to', contactName]);
	if (contactAddress) rows.push(['Address', contactAddress]);
	if (contactRegistrationNo) rows.push(['Reg no.', contactRegistrationNo]);
	if (contactPhone) rows.push(['Phone No.', contactPhone]);

	// Shift the whole content block for block-level alignment.
	// Labels stay left-aligned within the label column; only the starting x shifts.
	let startX = x;
	if (align !== 'left') {
		d.font(fonts.regular).fontSize(9);
		const maxValueW = Math.max(...rows.map(([, v]) => d.widthOfString(' : ' + v)));
		const contentW = Math.min(LABEL_W + maxValueW, width);
		startX = align === 'right' ? x + width - contentW : x + (width - contentW) / 2;
		startX = Math.max(x, startX);
	}
	const valueW = width - (startX - x) - LABEL_W;

	for (const [label, value] of rows) {
		const rowY = y;
		d.font(fonts.regular).fontSize(9).fillColor(C.dark)
			.text(label, startX, rowY, { width: LABEL_W });
		const labelEndY = d.y;
		d.font(fonts.regular).fontSize(9).fillColor(C.dark)
			.text(' : ' + value, startX + LABEL_W, rowY, { width: valueW });
		y = Math.max(labelEndY, d.y) + 3;
	}

	return y;
}
