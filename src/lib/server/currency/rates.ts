import { and, eq } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { exchangeRates } from '../db/schema.js';
import { getActiveProvider } from './provider.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = BunSQLiteDatabase<any>;

export type RateResult = {
	/** Units of `to` per 1 unit of `from`. Null when it could not be resolved. */
	rate: number | null;
	source: 'same' | 'cache' | 'api' | 'unavailable';
};

/**
 * Resolve the exchange rate to convert `from` → `to` on a given date.
 *
 * Cache-first: the `exchange_rates` table stores one row per pair in the provider's
 * native shape — `(date, base, quote, rate)` where `rate` is `quote` units per 1 `base`.
 * We look up the exact pair (or its reverse), and on a miss fetch it from the active
 * provider, cache it, and return. Returns `{ rate: null, source: 'unavailable' }` on any
 * failure so the caller can fall back to manual entry.
 */
export async function getExchangeRate(
	db: Db,
	{ from, to, date }: { from: string; to: string; date: string }
): Promise<RateResult> {
	const f = from.toUpperCase();
	const t = to.toUpperCase();
	if (f === t) return { rate: 1, source: 'same' };

	const cached = rateFromCache(db, date, f, t);
	if (cached != null) return { rate: cached, source: 'cache' };

	const fetched = await getActiveProvider().fetchRates({ base: f, quotes: [t], date });
	const rate = fetched?.[t];
	if (rate == null || !(rate > 0)) return { rate: null, source: 'unavailable' };

	cacheRate(db, date, f, t, rate);
	return { rate, source: 'api' };
}

/** Look up a cached rate for `from`→`to`, accepting the reverse row (inverted) too. */
function rateFromCache(db: Db, date: string, from: string, to: string): number | null {
	const direct = db
		.select({ rate: exchangeRates.rate })
		.from(exchangeRates)
		.where(
			and(eq(exchangeRates.date, date), eq(exchangeRates.base, from), eq(exchangeRates.quote, to))
		)
		.get();
	if (direct) return direct.rate;

	const reverse = db
		.select({ rate: exchangeRates.rate })
		.from(exchangeRates)
		.where(
			and(eq(exchangeRates.date, date), eq(exchangeRates.base, to), eq(exchangeRates.quote, from))
		)
		.get();
	if (reverse && reverse.rate > 0) return 1 / reverse.rate;

	return null;
}

function cacheRate(db: Db, date: string, base: string, quote: string, rate: number): void {
	db.insert(exchangeRates)
		.values({ date, base, quote, rate })
		.onConflictDoUpdate({
			target: [exchangeRates.date, exchangeRates.base, exchangeRates.quote],
			set: { rate }
		})
		.run();
}
