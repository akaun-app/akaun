import type PDFDocument from 'pdfkit';
import type { BlockDef, ThemeData } from '../template-types.js';
import { PT_PER_MM, C } from '../layout.js';

type Bounds = { x: number; y: number; width: number };
type Fonts = { regular: string; bold: string };
type RenderData = {
	settings: { companyName?: string; companyAddress?: string; companyRegistrationNo?: string };
};

export function render(
	doc: InstanceType<typeof PDFDocument>,
	block: BlockDef,
	data: RenderData,
	_theme: ThemeData,
	{ x, y, width }: Bounds,
	fonts: Fonts
): number {
	const cfg = block.config as { showLogo?: boolean; showAddress?: boolean };
	const mt = (block.style?.marginTop ?? 0) * PT_PER_MM;
	const mb = (block.style?.marginBottom ?? 0) * PT_PER_MM;
	y += mt;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const d = doc as any;
	const name = data.settings.companyName || 'Akaun';
	d.font(fonts.bold).fontSize(20).fillColor(C.dark).text(name, x, y, { width });
	y = d.y;

	if (cfg.showAddress !== false && data.settings.companyAddress) {
		d.font(fonts.regular).fontSize(10).fillColor(C.subtle)
			.text(data.settings.companyAddress, x, y + 4, { width });
		y = d.y;
	}
	if (data.settings.companyRegistrationNo) {
		d.font(fonts.regular).fontSize(9).fillColor(C.muted)
			.text('Reg. No: ' + data.settings.companyRegistrationNo, x, y + 4, { width });
		y = d.y;
	}
	return y + mb;
}
