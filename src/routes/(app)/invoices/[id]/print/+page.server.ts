import type { PageServerLoad } from './$types.js';
import { db } from '$lib/server/db/client.js';
import { getInvoice } from '$lib/server/queries/invoices.js';
import { redirect } from '@sveltejs/kit';
import { settings } from '$lib/server/db/schema.js';

export const load: PageServerLoad = ({ params, locals }) => {
	if (!locals.user) throw redirect(302, '/login');
	const invoice = getInvoice(db, parseInt(params.id));
	if (!invoice) throw redirect(302, '/invoices');

	const settingRows = db.select().from(settings).all();
	const settingsMap: Record<string, string> = {};
	for (const row of settingRows) {
		settingsMap[row.key] = row.value;
	}

	return { invoice, settings: settingsMap };
};
