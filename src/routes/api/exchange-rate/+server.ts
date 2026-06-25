import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db/client.js';
import { getExchangeRate } from '$lib/server/currency/rates.js';
import type { RequestHandler } from './$types.js';

// Live rate lookup for the create/edit forms. Returns the main-currency rate per 1 unit
// of `from` on the given date, or `{ rate: null }` when unavailable (unsupported currency
// / API error) so the client can prompt for manual entry.
export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) return new Response('Unauthorized', { status: 401 });

	const from = (url.searchParams.get('from') ?? '').trim().toUpperCase();
	const to = (url.searchParams.get('to') ?? '').trim().toUpperCase();
	const date = (url.searchParams.get('date') ?? '').trim();

	if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
		return json({ error: 'from, to and a YYYY-MM-DD date are required' }, { status: 400 });
	}

	const result = await getExchangeRate(db, { from, to, date });
	return json({ rate: result.rate, source: result.source });
};
