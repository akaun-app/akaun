export const PT_PER_MM = 2.8346; // points per millimetre

export const M = 56.69; // 20mm page margin in points
export const PW = 595.28; // A4 width
export const CW = PW - 2 * M; // content width ≈ 481.9

// Line items table column widths and X positions
export const COL_DESC = 248;
export const COL_QTY = 55;
export const COL_PRICE = 90;
export const COL_TOTAL = CW - COL_DESC - COL_QTY - COL_PRICE;

export const TX_QTY = M + COL_DESC;
export const TX_PRICE = TX_QTY + COL_QTY;
export const TX_TOTAL = TX_PRICE + COL_PRICE;

export const C = {
	dark: '#111111',
	body: '#1a1a1a',
	subtle: '#555555',
	muted: '#888888',
	light: '#e5e5e5',
	red: '#c0392b',
	green: '#166534'
} as const;

export function fmt(n: number): string {
	return new Intl.NumberFormat('en-MY', {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2
	}).format(n);
}

export function fmtDate(iso: string | null | undefined): string {
	if (!iso) return '';
	const [y, m, d] = iso.split('-');
	const months = [
		'January', 'February', 'March', 'April', 'May', 'June',
		'July', 'August', 'September', 'October', 'November', 'December'
	];
	return `${parseInt(d)} ${months[parseInt(m) - 1]} ${y}`;
}
