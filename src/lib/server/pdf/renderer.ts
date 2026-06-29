import PDFDocument from 'pdfkit';
import type { BlockDef, TemplateLayout, ThemeData } from './template-types.js';
import { TemplateFont } from '$lib/enums.js';
import { M, CW } from './layout.js';
import { renderRow } from './multi-column.js';

// Block renderer imports
import { render as renderCompanyName }    from './blocks/company-name.js';
import { render as renderCompanyAddress } from './blocks/company-address.js';
import { render as renderCompanyRegInfo } from './blocks/company-reg-info.js';
import { render as renderDocumentTitle }  from './blocks/document-title.js';
import { render as renderDocumentMeta }   from './blocks/document-meta.js';
import { render as renderCustomerBlock }  from './blocks/customer-block.js';
import { render as renderLineItemsTable } from './blocks/line-items-table.js';
import { render as renderTotalsBlock }    from './blocks/totals-block.js';
import { render as renderNotes }          from './blocks/notes.js';
import { render as renderPaidStamp }      from './blocks/paid-stamp.js';
import { render as renderIssuedBy }       from './blocks/issued-by.js';
import { render as renderText }           from './blocks/text.js';
import { render as renderImage }          from './blocks/image.js';
import { render as renderDivider }        from './blocks/divider.js';
import { render as renderSpacer }         from './blocks/spacer.js';

type Bounds = { x: number; y: number; width: number };
type Fonts = { regular: string; bold: string };

function fontsForTheme(theme: ThemeData): Fonts {
	// PDFKit ships Helvetica and Times-Roman only.
	// Inter/Roboto/Lato all map to Helvetica; Merriweather maps to Times-Roman.
	const useSerif = theme.font === TemplateFont.Merriweather;
	return useSerif
		? { regular: 'Times-Roman', bold: 'Times-Bold' }
		: { regular: 'Helvetica', bold: 'Helvetica-Bold' };
}

export function renderBlock(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	doc: any,
	block: BlockDef,
	data: unknown,
	theme: ThemeData,
	bounds: Bounds,
	fonts: Fonts
): number {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const d = data as any;
	switch (block.type) {
		case 'company-name':    return renderCompanyName(doc, block, d, theme, bounds, fonts);
		case 'company-address': return renderCompanyAddress(doc, block, d, theme, bounds, fonts);
		case 'company-reg-info':return renderCompanyRegInfo(doc, block, d, theme, bounds, fonts);
		case 'document-title':  return renderDocumentTitle(doc, block, d, theme, bounds, fonts);
		case 'document-meta':   return renderDocumentMeta(doc, block, d, theme, bounds, fonts);
		case 'customer-block':  return renderCustomerBlock(doc, block, d, theme, bounds, fonts);
		case 'line-items-table':return renderLineItemsTable(doc, block, d, theme, bounds, fonts);
		case 'totals-block':    return renderTotalsBlock(doc, block, d, theme, bounds, fonts);
		case 'notes':           return renderNotes(doc, block, d, theme, bounds, fonts);
		case 'paid-stamp':      return renderPaidStamp(doc, block, d, theme, bounds, fonts);
		case 'issued-by':       return renderIssuedBy(doc, block, d, theme, bounds, fonts);
		case 'text':            return renderText(doc, block, d, theme, bounds, fonts);
		case 'image':           return renderImage(doc, block, d, theme, bounds, fonts);
		case 'divider':         return renderDivider(doc, block, d, theme, bounds, fonts);
		case 'spacer':          return renderSpacer(doc, block, d, theme, bounds, fonts);
		default:
			return bounds.y;
	}
}

export type LayoutRenderData = {
	document: Record<string, unknown> & {
		lines: { description: string; quantity: number; unitPrice: number; lineTotal: number }[];
		subtotal: number;
		taxAmount: number;
		total: number;
		currency: string;
	};
	settings: { companyName?: string; companyAddress?: string; companyRegistrationNo?: string };
	docTypeLabel: string;
};

export function buildPdfFromTemplate(
	layout: TemplateLayout,
	theme: ThemeData,
	data: LayoutRenderData,
	title: string
): Promise<Buffer> {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const doc = new (PDFDocument as any)({ size: 'A4', margin: 0, info: { Title: title } });
	const fonts = fontsForTheme(theme);

	let y = M;

	// ── HEADER ───────────────────────────────────────────────────────────────
	for (const row of layout.header.rows) {
		y = renderRow(doc, row.blocks, data, theme, { x: M, y, width: CW }, fonts);
		y += 6;
	}
	y += 6;

	// Horizontal rule after header
	doc.moveTo(M, y).lineTo(M + CW, y).lineWidth(2).strokeColor('#111111').stroke();
	y += 24;

	// ── BODY ─────────────────────────────────────────────────────────────────
	for (const row of layout.body.rows) {
		y = renderRow(doc, row.blocks, data, theme, { x: M, y, width: CW }, fonts);
		y += 4;
	}

	// ── FOOTER ───────────────────────────────────────────────────────────────
	const hasFooter = layout.footer.rows.some((r) => r.blocks.length > 0);
	if (hasFooter) {
		y += 12;
		for (const row of layout.footer.rows) {
			y = renderRow(doc, row.blocks, data, theme, { x: M, y, width: CW }, fonts);
			y += 6;
		}
	}

	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		doc.on('data', (chunk: Buffer) => chunks.push(chunk));
		doc.on('end', () => resolve(Buffer.concat(chunks)));
		doc.on('error', reject);
		doc.end();
	});
}
