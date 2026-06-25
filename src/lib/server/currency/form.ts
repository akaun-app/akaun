import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { getSetting, SETTING_KEYS } from '../settings.js';
import { getExchangeRate } from './rates.js';
import { DEFAULT_CURRENCY } from '$lib/currency.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = BunSQLiteDatabase<any>;

export type CurrencyResolution =
	| { ok: true; currency: string; exchangeRate: number }
	| { ok: false; message: string };

export function mainCurrencyCode(db: Db): string {
	return (getSetting(db, SETTING_KEYS.currencyCode) ?? DEFAULT_CURRENCY).toUpperCase();
}

/**
 * Resolve the currency + exchange rate for a record being created from form data.
 * - Same as main currency → rate 1.
 * - Foreign with a manual rate supplied → use it (server is source of truth, but trusts
 *   a positive client-supplied rate, e.g. when no API key is configured).
 * - Foreign with no rate → fetch from CurrencyFreaks for the transaction date; if still
 *   unavailable, returns an error so the caller can prompt for a manual rate.
 */
export async function resolveRecordCurrency(
	db: Db,
	data: FormData,
	date: string
): Promise<CurrencyResolution> {
	const main = mainCurrencyCode(db);
	const currency = (String(data.get('currency') ?? '').trim() || main).toUpperCase();

	if (currency === main) return { ok: true, currency: main, exchangeRate: 1 };

	const rateRaw = String(data.get('exchangeRate') ?? '').trim();
	if (rateRaw) {
		const rate = parseFloat(rateRaw);
		if (isNaN(rate) || rate <= 0) {
			return { ok: false, message: 'Exchange rate must be a positive number' };
		}
		return { ok: true, currency, exchangeRate: rate };
	}

	const result = await getExchangeRate(db, { from: currency, to: main, date });
	if (result.rate == null) {
		return {
			ok: false,
			message: `Couldn't fetch an exchange rate for ${currency}. Enter the rate manually.`
		};
	}
	return { ok: true, currency, exchangeRate: result.rate };
}
