/**
 * Token grammar for customizable document-number templates (expenses, income,
 * claims, quotations, invoices). Lives outside `src/lib/server/` so it can be
 * imported both by server code (real number generation) and by the Settings
 * page (`+page.svelte`, live client-side preview) — the two must never drift,
 * so this is the single place the grammar is defined.
 */

export type SequenceDocType = 'expense' | 'income' | 'claim' | 'quotation' | 'invoice';

/** Fixed per-type codes resolved by the {PREFIX} token. Not user-editable. */
export const SEQUENCE_PREFIXES: Record<SequenceDocType, string> = {
	expense: 'EX',
	income: 'IN',
	claim: 'CL',
	quotation: 'QT',
	invoice: 'IV'
};

/** One shared template applied to every document type — {PREFIX} supplies the per-type code. */
export const DEFAULT_SEQUENCE_TEMPLATE = '{PREFIX}{YYYY}{MM}{DD}-{SEQ:3}';

type TemplateToken = 'PREFIX' | 'YYYY' | 'YY' | 'MM' | 'DD' | 'SEQ';

export const TOKEN_REGEX = /\{(PREFIX|YYYY|YY|MM|DD|SEQ)(?::(\d+))?\}/g;

function dateTokenValues(date: string): Record<'YYYY' | 'YY' | 'MM' | 'DD', string> {
	const [y, m, d] = date.split('-');
	return { YYYY: y, YY: y.slice(2), MM: m, DD: d };
}

/**
 * Renders `template` for `documentType`/`date`/`seq`. Pure string substitution —
 * used both for the real generated number (server) and the client-side live
 * preview (identical output by construction).
 */
export function renderTemplate(
	template: string,
	documentType: SequenceDocType,
	date: string,
	seq: number
): string {
	const dv = dateTokenValues(date);
	return template.replace(TOKEN_REGEX, (_m, name: TemplateToken, width?: string) => {
		if (name === 'SEQ') return String(seq).padStart(width ? parseInt(width, 10) : 3, '0');
		if (name === 'PREFIX') return SEQUENCE_PREFIXES[documentType];
		return dv[name];
	});
}

/**
 * Derives the sequence-counter bucket key for `template` on `date`: resolve
 * {PREFIX} and date tokens to literal values, strip the {SEQ[:N]} token
 * entirely (it has no bearing on the bucket), leave all other literal
 * characters untouched. A template with {DD} => new bucket per day; {YYYY}
 * only => new bucket per year; no date tokens => a single constant bucket
 * (never resets).
 */
export function deriveBucketKey(template: string, documentType: SequenceDocType, date: string): string {
	const dv = dateTokenValues(date);
	return template.replace(TOKEN_REGEX, (_m, name: TemplateToken) => {
		if (name === 'SEQ') return '';
		if (name === 'PREFIX') return SEQUENCE_PREFIXES[documentType];
		return dv[name];
	});
}

/**
 * Validates a template string. Returns an error message, or null if valid.
 * Shared by the client-side preview and the server save action so the two
 * never drift.
 */
export function validateTemplate(template: string): string | null {
	if (!template || !template.trim()) return 'Template cannot be empty';
	if (template.length > 60) return 'Template is too long (max 60 characters)';

	const stripped = template.replace(TOKEN_REGEX, '');
	if (/[{}]/.test(stripped)) return 'Contains an unrecognized token';

	const matches = [...template.matchAll(TOKEN_REGEX)];

	const seqMatches = matches.filter((m) => m[1] === 'SEQ');
	if (seqMatches.length === 0) return 'Template must contain exactly one {SEQ} or {SEQ:N} token';
	if (seqMatches.length > 1) return 'Template must contain only one {SEQ} or {SEQ:N} token';

	const prefixMatches = matches.filter((m) => m[1] === 'PREFIX');
	if (prefixMatches.length > 1) return 'Template must contain at most one {PREFIX} token';

	const nonSeqWithWidth = matches.filter((m) => m[1] !== 'SEQ' && m[2] !== undefined);
	if (nonSeqWithWidth.length > 0) return 'Only {SEQ} supports a :N width suffix';

	const width = seqMatches[0][2];
	if (width !== undefined) {
		const n = parseInt(width, 10);
		if (!(n >= 1 && n <= 10)) return 'Sequence width must be between 1 and 10 digits';
	}

	return null;
}
