// Reactive holder for the active main currency. The main currency is a single global
// setting, so a module-level reactive value (set once from the (app) layout) lets every
// component format money in the main currency without threading a prop through the tree.

import {
	DEFAULT_CURRENCY,
	currencySymbol,
	formatCurrency,
	formatCurrencyAmount
} from './currency.js';

const state = $state({ code: DEFAULT_CURRENCY });

export function setMainCurrency(code: string | null | undefined): void {
	state.code = (code ?? DEFAULT_CURRENCY).toUpperCase();
}

/** The active main-currency code (reactive). */
export function mainCurrency(): string {
	return state.code;
}

/** The active main-currency symbol (reactive), e.g. "$" or "RM". */
export function mainCurrencySymbol(): string {
	return currencySymbol(state.code);
}

/** Format a number in the main currency, prefixed with its symbol. */
export function formatMoney(n: number): string {
	return formatCurrency(n, state.code);
}

/** Format a number in the main currency's locale/decimals, no symbol prefix. */
export function formatMoneyAmount(n: number): string {
	return formatCurrencyAmount(n, state.code);
}
