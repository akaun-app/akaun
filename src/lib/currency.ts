// Curated ISO-4217 currency registry used across the app. The main currency is a
// single global setting; foreign-currency records carry their own code and are always
// converted back to the main currency for display and statistics.

export type CurrencyMeta = {
	code: string;
	name: string;
	symbol: string;
	locale: string;
	decimals: number;
};

export const CURRENCIES: CurrencyMeta[] = [
	{ code: 'USD', name: 'US Dollar', symbol: '$', locale: 'en-US', decimals: 2 },
	{ code: 'MYR', name: 'Malaysian Ringgit', symbol: 'RM', locale: 'en-MY', decimals: 2 },
	{ code: 'SGD', name: 'Singapore Dollar', symbol: 'S$', locale: 'en-SG', decimals: 2 },
	{ code: 'EUR', name: 'Euro', symbol: '€', locale: 'en-IE', decimals: 2 },
	{ code: 'GBP', name: 'British Pound', symbol: '£', locale: 'en-GB', decimals: 2 },
	{ code: 'JPY', name: 'Japanese Yen', symbol: '¥', locale: 'ja-JP', decimals: 0 },
	{ code: 'CNY', name: 'Chinese Yuan', symbol: 'CN¥', locale: 'zh-CN', decimals: 2 },
	{ code: 'HKD', name: 'Hong Kong Dollar', symbol: 'HK$', locale: 'en-HK', decimals: 2 },
	{ code: 'AUD', name: 'Australian Dollar', symbol: 'A$', locale: 'en-AU', decimals: 2 },
	{ code: 'NZD', name: 'New Zealand Dollar', symbol: 'NZ$', locale: 'en-NZ', decimals: 2 },
	{ code: 'CAD', name: 'Canadian Dollar', symbol: 'C$', locale: 'en-CA', decimals: 2 },
	{ code: 'CHF', name: 'Swiss Franc', symbol: 'CHF', locale: 'de-CH', decimals: 2 },
	{ code: 'INR', name: 'Indian Rupee', symbol: '₹', locale: 'en-IN', decimals: 2 },
	{ code: 'IDR', name: 'Indonesian Rupiah', symbol: 'Rp', locale: 'id-ID', decimals: 0 },
	{ code: 'THB', name: 'Thai Baht', symbol: '฿', locale: 'th-TH', decimals: 2 },
	{ code: 'PHP', name: 'Philippine Peso', symbol: '₱', locale: 'en-PH', decimals: 2 },
	{ code: 'VND', name: 'Vietnamese Dong', symbol: '₫', locale: 'vi-VN', decimals: 0 },
	{ code: 'KRW', name: 'South Korean Won', symbol: '₩', locale: 'ko-KR', decimals: 0 },
	{ code: 'TWD', name: 'New Taiwan Dollar', symbol: 'NT$', locale: 'zh-TW', decimals: 2 },
	{ code: 'AED', name: 'UAE Dirham', symbol: 'AED', locale: 'en-AE', decimals: 2 }
];

const BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]));

export const DEFAULT_CURRENCY = 'USD';

export function currencyMeta(code: string | null | undefined): CurrencyMeta {
	const upper = (code ?? DEFAULT_CURRENCY).toUpperCase();
	return (
		BY_CODE.get(upper) ?? {
			code: upper,
			name: upper,
			symbol: upper,
			locale: 'en-US',
			decimals: 2
		}
	);
}

export function currencySymbol(code: string | null | undefined): string {
	return currencyMeta(code).symbol;
}

export function currencyDecimals(code: string | null | undefined): number {
	return currencyMeta(code).decimals;
}

// Memoised Intl.NumberFormat per currency code — building one is relatively expensive.
const fmtCache = new Map<string, Intl.NumberFormat>();

function formatter(code: string): Intl.NumberFormat {
	const cached = fmtCache.get(code);
	if (cached) return cached;
	const meta = currencyMeta(code);
	const fmt = new Intl.NumberFormat(meta.locale, {
		minimumFractionDigits: meta.decimals,
		maximumFractionDigits: meta.decimals
	});
	fmtCache.set(code, fmt);
	return fmt;
}

/** Format a number in the given currency, prefixed with its symbol, e.g. "$1,234.56". */
export function formatCurrency(n: number, code: string | null | undefined): string {
	const meta = currencyMeta(code);
	return `${meta.symbol} ${formatter(meta.code).format(n ?? 0)}`;
}

/** Format a number using the given currency's locale/decimals, with no symbol prefix. */
export function formatCurrencyAmount(n: number, code: string | null | undefined): string {
	return formatter(currencyMeta(code).code).format(n ?? 0);
}
