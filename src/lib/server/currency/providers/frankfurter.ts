import type { ExchangeRateProvider } from '../provider.js';
import { createLogger } from '../../logger.js';

const log = createLogger('currency:frankfurter');

// Frankfurter is an open-source, free, key-less FX API over central-bank reference rates.
// It accepts an arbitrary `base`, so we fetch directly against the app's main currency —
// no USD pivot. Note: it covers only the ECB reference set (~30 currencies) and, for a
// non-trading day (weekend/holiday) or a date before the requested currency existed, it
// returns the most recent published rate on/before that date. Unsupported codes yield no
// row for that quote → we return null → the caller falls back to manual entry.
const RATES_URL = 'https://api.frankfurter.dev/v2/rates';

export const frankfurterProvider: ExchangeRateProvider = {
	id: 'frankfurter',

	async fetchRates({ base, quotes, date }) {
		const symbols = quotes.filter((q) => q && q !== base);
		if (symbols.length === 0) return {};

		const url = `${RATES_URL}?base=${encodeURIComponent(base)}&quotes=${encodeURIComponent(
			symbols.join(',')
		)}&date=${encodeURIComponent(date)}`;

		for (let attempt = 0; attempt < 3; attempt++) {
			try {
				const res = await fetch(url);
				const bodyText = await res.text();
				if (res.status === 429 || res.status >= 500) {
					log.warn({ status: res.status, attempt }, 'Rate limit/server error, retrying');
					await sleep(Math.pow(2, attempt) * 1000);
					continue;
				}
				if (!res.ok) {
					// 4xx (bad date, unknown currency) — not retryable.
					log.warn({ status: res.status, body: bodyText.slice(0, 200) }, 'Request failed');
					return null;
				}
				// `/v2/rates` for a single date returns an array of { date, base, quote, rate }.
				const data = JSON.parse(bodyText) as Array<{ quote?: string; rate?: number }>;
				if (!Array.isArray(data)) return null;
				const out: Record<string, number> = {};
				for (const row of data) {
					const code = row.quote?.toUpperCase();
					if (code && typeof row.rate === 'number' && row.rate > 0) out[code] = row.rate;
				}
				return out;
			} catch (err) {
				log.warn({ err, attempt }, 'Fetch error');
				if (attempt === 2) return null;
				await sleep(Math.pow(2, attempt) * 1000);
			}
		}
		return null;
	}
};

function sleep(ms: number) {
	return new Promise((r) => setTimeout(r, ms));
}
