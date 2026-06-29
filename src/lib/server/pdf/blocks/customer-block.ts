import type PDFDocument from 'pdfkit';
import type { BlockDef, ThemeData } from '../template-types.js';
import { PT_PER_MM, C } from '../layout.js';

type Bounds = { x: number; y: number; width: number };
type Fonts = { regular: string; bold: string };
type RenderData = {
	document: {
		contactName?: string | null;
		contactAddress?: string | null;
		contactRegistrationNo?: string | null;
	};
};

export function render(
	doc: InstanceType<typeof PDFDocument>,
	block: BlockDef,
	data: RenderData,
	_theme: ThemeData,
	{ x, y, width }: Bounds,
	fonts: Fonts
): number {
	const { contactName, contactAddress, contactRegistrationNo } = data.document;
	if (!contactName && !contactAddress) return y;
	const cfg = block.config as { showRegistrationNo?: boolean; label?: string };
	const mt = (block.style?.marginTop ?? 0) * PT_PER_MM;
	const mb = (block.style?.marginBottom ?? 0) * PT_PER_MM;
	y += mt;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const d = doc as any;
	d.font(fonts.bold).fontSize(8).fillColor(C.muted)
		.text(cfg.label ?? 'BILL TO', x, y, { width, characterSpacing: 0.5 });
	y = d.y + 2;
	if (contactName) {
		d.font(fonts.bold).fontSize(11).fillColor(C.dark).text(contactName, x, y, { width });
		y = d.y;
	}
	if (contactAddress) {
		d.font(fonts.regular).fontSize(10).fillColor(C.subtle).text(contactAddress, x, y + 2, { width });
		y = d.y;
	}
	if (cfg.showRegistrationNo !== false && contactRegistrationNo) {
		d.font(fonts.regular).fontSize(9).fillColor(C.muted)
			.text('Reg. No: ' + contactRegistrationNo, x, y + 2, { width });
		y = d.y;
	}
	return y + mb;
}
