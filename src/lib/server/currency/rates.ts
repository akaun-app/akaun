import { and, eq, inArray } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { exchangeRates } from '../db/schema.js';
import { getSetting, SETTING_KEYS } from '../settings.js';
import { getActiveProvider } from './provider.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = BunSQLiteDatabase<any>;

export type RateResult = {
	/** Main-currency units per 1 unit of `from`. Null when it could not be resolved. */
	rate: number | null;
	source: 'same' | 'cache' | 'api' | 'unavailable';
};

// CurrencyFreaks returns USD-based rates (units of a currency per 1 USD). USD itself
// is implicitly 1. We cross-compute any pair: rate(to per from) = usd[to] / usd[from].
const USD = 'USD';

/**
 * Resolve the exchange rate to convert `from` → `to` on a given date.
 *
 * Cache-first: reads USD-based rows from `exchange_rates`; on a miss, calls the
 * CurrencyFreaks historical endpoint (if an API key is set), caches the result, then
 * cross-computes. Returns `{ rate: null, source: 'unavailable' }` on any failure so the
 * caller can fall back to manual entry.
 */
export async function getExchangeRate(
	db: Db,
	{ from, to, date }: { from: string; to: string; date: string }
): Promise<RateResult> {
	const f = from.toUpperCase();
	const t = to.toUpperCase();
	if (f === t) return { rate: 1, source: 'same' };

	// USD-per-unit rate for a code on this date (USD itself is 1). Returns null if unknown.
	const cached = usdRatesFromCache(db, date, [f, t]);
	if (cached[f] != null && cached[t] != null) {
		return { rate: cached[t]! / cached[f]!, source: 'cache' };
	}

	const apiKey = getSetting(db, SETTING_KEYS.exchangeApiKey);
	if (!apiKey) return { rate: null, source: 'unavailable' };

	const codes = [f, t].filter((c) => c !== USD);
	const fetched = await getActiveProvider().fetchUsdRates({ date, codes, apiKey });
	if (!fetched) return { rate: null, source: 'unavailable' };

	// Merge fetched into the full picture (cache + USD-is-1) and cache new rows.
	upsertRates(db, date, fetched);
	const all: Record<string, number | null> = { ...cached, [USD]: 1, ...fetched };
	if (all[f] != null && all[t] != null) {
		return { rate: all[t]! / all[f]!, source: 'api' };
	}
	return { rate: null, source: 'unavailable' };
}

function usdRatesFromCache(db: Db, date: string, codes: string[]): Record<string, number | null> {
	const out: Record<string, number | null> = {};
	for (const c of codes) out[c] = c === USD ? 1 : null;
	const wanted = codes.filter((c) => c !== USD);
	if (wanted.length > 0) {
		const rows = db
			.select()
			.from(exchangeRates)
			.where(and(eq(exchangeRates.date, date), inArray(exchangeRates.code, wanted)))
			.all();
		for (const r of rows) out[r.code] = r.rate;
	}
	return out;
}

function upsertRates(db: Db, date: string, rates: Record<string, number>): void {
	for (const [code, rate] of Object.entries(rates)) {
		if (code === USD) continue;
		db.insert(exchangeRates)
			.values({ date, code, rate })
			.onConflictDoUpdate({
				target: [exchangeRates.date, exchangeRates.code],
				set: { rate }
			})
			.run();
	}
}
