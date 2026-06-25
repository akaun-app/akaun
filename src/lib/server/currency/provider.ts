// Exchange-rate provider abstraction. The rate cache and conversion logic in rates.ts
// are provider-agnostic — they only need USD-based rates for a date. To switch providers
// (e.g. off CurrencyFreaks, whose transaction-date history needs a paid plan), implement
// this interface and register it in `getActiveProvider`; no other code changes.

export interface ExchangeRateProvider {
	/** Stable identifier, used in logs/telemetry. */
	readonly id: string;

	/**
	 * Fetch USD-based rates (units of each code per 1 USD) for `date`.
	 * Return null on any failure (missing key, plan limit, network, bad response) so the
	 * caller can fall back to manual entry. `codes` excludes USD (implicitly 1).
	 */
	fetchUsdRates(opts: {
		date: string;
		codes: string[];
		apiKey: string;
	}): Promise<Record<string, number> | null>;
}

import { currencyFreaksProvider } from './providers/currencyfreaks.js';

/**
 * The active provider. Swapping providers later is a one-line change here (or wire it to
 * a setting if multiple are offered). Kept as a function so the choice can become dynamic.
 */
export function getActiveProvider(): ExchangeRateProvider {
	return currencyFreaksProvider;
}
