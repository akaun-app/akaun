import type { ExchangeRateProvider } from '../provider.js';
import { createLogger } from '../../logger.js';

const log = createLogger('currency:currencyfreaks');

// CurrencyFreaks historical endpoint. Returns USD-based rates by default (the free plan
// is USD-base only; the `base` param needs a paid plan, so we never use it — rates.ts
// cross-computes any pair via USD). Note: the historical endpoint itself requires a paid
// plan; on the free plan these calls fail and we fall back to manual entry.
const HISTORICAL_URL = 'https://api.currencyfreaks.com/v2.0/rates/historical';

export const currencyFreaksProvider: ExchangeRateProvider = {
	id: 'currencyfreaks',

	async fetchUsdRates({ date, codes, apiKey }) {
		const symbols = codes.join(',');
		const url = `${HISTORICAL_URL}?apikey=${encodeURIComponent(apiKey)}&date=${encodeURIComponent(
			date
		)}&symbols=${encodeURIComponent(symbols)}`;

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
					// 4xx (bad key, plan limit, bad date) — not retryable.
					log.warn({ status: res.status, body: bodyText.slice(0, 200) }, 'Request failed');
					return null;
				}
				const data = JSON.parse(bodyText) as { rates?: Record<string, string> };
				if (!data.rates) return null;
				const out: Record<string, number> = {};
				for (const [code, val] of Object.entries(data.rates)) {
					const n = parseFloat(val);
					if (!isNaN(n) && n > 0) out[code.toUpperCase()] = n;
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
