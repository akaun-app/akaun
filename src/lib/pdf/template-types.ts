// Shared template types — safe to import in both server and browser code.
// Server-only DB helpers live in $lib/server/pdf/template-types.ts.

// ---------------------------------------------------------------------------
// TemplateRow — mirrors document_templates schema as a plain interface
// ---------------------------------------------------------------------------

export type TemplateRow = {
	id: number;
	uuid: string;
	name: string;
	documentType: number;
	isDefault: number;
	themeColor: string;
	themeFont: number;
	layoutJson: string;
	createdBy: number | null;
	updatedBy: number | null;
	createdAt: string;
	updatedAt: string;
};

// ---------------------------------------------------------------------------
// Block types
// ---------------------------------------------------------------------------

export type BlockType =
	| 'company-header'
	| 'document-meta'
	| 'customer-block'
	| 'line-items-table'
	| 'totals-block'
	| 'notes'
	| 'paid-stamp'
	| 'issued-by'
	| 'text'
	| 'image'
	| 'divider'
	| 'spacer';

export type BlockStyle = {
	marginTop?: number;
	marginBottom?: number;
	align?: 'left' | 'center' | 'right';
};

export type BlockDef = {
	id: string;
	type: BlockType;
	config: Record<string, unknown>;
	style?: BlockStyle;
};

export type ColumnDef = {
	width: number;
	blocks: BlockDef[];
};

export type TemplateLayout = {
	header: { columns: ColumnDef[] };
	body: { blocks: BlockDef[] };
	footer: { columns: ColumnDef[] };
};

export type ThemeData = {
	color: string;
	font: number;
};

// ---------------------------------------------------------------------------
// Block classification constants
// ---------------------------------------------------------------------------

export const BODY_ONLY_BLOCKS: BlockType[] = ['line-items-table', 'totals-block'];
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
// Default layout factory
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
