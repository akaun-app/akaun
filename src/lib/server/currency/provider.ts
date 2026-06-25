// Exchange-rate provider abstraction. The rate cache and conversion logic in rates.ts
// are provider-agnostic — they only need quote-per-base rates for a date. To switch
// providers, implement this interface and register it in `getActiveProvider`; no other
// code changes.

export interface ExchangeRateProvider {
	/** Stable identifier, used in logs/telemetry. */
	readonly id: string;

	/**
	 * Fetch quote-per-base rates for `date` — i.e. for each returned `quote`, how many
	 * units of it equal 1 unit of `base`. Return null on any failure (network, plan limit,
	 * unsupported currency, bad response) so the caller can fall back to manual entry.
	 */
	fetchRates(opts: {
		base: string;
		quotes: string[];
		date: string;
	}): Promise<Record<string, number> | null>;
}

import { frankfurterProvider } from './providers/frankfurter.js';

/**
 * The active provider. Swapping providers later is a one-line change here (or wire it to
 * a setting if multiple are offered). Kept as a function so the choice can become dynamic.
 */
export function getActiveProvider(): ExchangeRateProvider {
	return frankfurterProvider;
}
