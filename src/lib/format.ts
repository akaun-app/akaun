// Money formatting now lives in the currency layer so it tracks the active main
// currency. These are kept as thin re-exports for the many existing call sites.
//   - formatMoney(n)   → main-currency value, no symbol  (e.g. "1,234.56")
//   - formatMoneyRM(n) → main-currency value, with symbol (e.g. "$ 1,234.56")
// `formatMoneyRM` keeps its historical name only for compatibility; it is no longer
// RM-specific. Use `formatCurrency`/`formatMoney` from the currency modules in new code.
export { formatMoneyAmount as formatMoney, formatMoney as formatMoneyRM } from './currency-state.svelte.js';

export function formatDateShort(iso: string): string {
	if (!iso) return '';
	const [, m, d] = iso.split('-');
	const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
	return `${parseInt(d)} ${months[parseInt(m) - 1]}`;
}

export function formatDate(iso: string): string {
	if (!iso) return '';
	const [y, m, d] = iso.split('-');
	const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
	return `${parseInt(d)} ${months[parseInt(m) - 1]} ${y}`;
}

export function monthLabel(iso: string): string {
	const [y, m] = iso.split('-');
	const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
	return `${months[parseInt(m) - 1]} ${y}`;
}
