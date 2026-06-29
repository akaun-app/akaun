import type { InferSelectModel } from 'drizzle-orm';
import type { documentTemplates } from '$lib/server/db/schema.js';

export type TemplateRow = InferSelectModel<typeof documentTemplates>;

// ---------------------------------------------------------------------------
// Block types
// ---------------------------------------------------------------------------

export type BlockType =
	// System blocks — repositionable but not deletable
	| 'company-header'
	| 'document-meta'
	| 'customer-block'
	| 'line-items-table'
	| 'totals-block'
	// Optional system blocks — removable
	| 'notes'
	| 'paid-stamp'
	| 'issued-by'
	// Custom blocks — freely added/removed
	| 'text'
	| 'image'
	| 'divider'
	| 'spacer';

export type BlockStyle = {
	marginTop?: number; // mm
	marginBottom?: number; // mm
	align?: 'left' | 'center' | 'right';
};

export type BlockDef = {
	id: string; // stable uuid within the layout; used as drag-drop key
	type: BlockType;
	config: Record<string, unknown>;
	style?: BlockStyle;
};

export type ColumnDef = {
	width: number; // percentage of zone width; columns in a zone must sum to 100
	blocks: BlockDef[];
};

export type TemplateLayout = {
	header: { columns: ColumnDef[] };
	body: { blocks: BlockDef[] };
	footer: { columns: ColumnDef[] };
};

export type ThemeData = {
	color: string; // hex e.g. '#1a56db'
	font: number; // TemplateFont code: 1=Inter→Helvetica, 4=Merriweather→Times-Roman
};

// ---------------------------------------------------------------------------
// Block classification constants
// ---------------------------------------------------------------------------

// These two types are body-zone-only; drop handler must reject them in header/footer
export const BODY_ONLY_BLOCKS: BlockType[] = ['line-items-table', 'totals-block'];

// System-required blocks cannot be removed from the canvas
export const SYSTEM_REQUIRED_BLOCKS: BlockType[] = [
	'company-header',
	'document-meta',
	'customer-block',
	'line-items-table',
	'totals-block'
];

export const SYSTEM_OPTIONAL_BLOCKS: BlockType[] = ['notes', 'paid-stamp', 'issued-by'];
export const CUSTOM_BLOCKS: BlockType[] = ['text', 'image', 'divider', 'spacer'];

// ---------------------------------------------------------------------------
// Default layout (seeded on first boot when no templates exist)
// ---------------------------------------------------------------------------

export function makeDefaultLayout(): TemplateLayout {
	const id = () => crypto.randomUUID();
	return {
		header: {
			columns: [
				{
					width: 40,
					blocks: [{ id: id(), type: 'company-header', config: { showLogo: true, showAddress: true } }]
				},
				{
					width: 60,
					blocks: [{ id: id(), type: 'document-meta', config: { showReference: true } }]
				}
			]
		},
		body: {
			blocks: [
				{ id: id(), type: 'customer-block', config: { showRegistrationNo: true } },
				{ id: id(), type: 'line-items-table', config: { showUnitPrice: true, showQty: true } },
				{ id: id(), type: 'totals-block', config: { showTaxRow: true } },
				{ id: id(), type: 'notes', config: { label: 'Notes' } }
			]
		},
		footer: { columns: [{ width: 100, blocks: [] }] }
	};
}
