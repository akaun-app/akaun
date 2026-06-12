import type { LayoutServerLoad } from './$types.js';
import { db } from '$lib/server/db/client.js';
import { getSetting } from '$lib/server/settings.js';
import { listExpenses } from '$lib/server/queries/expenses.js';

export const load: LayoutServerLoad = async ({ locals }) => {
	const user = locals.user;
	const godMode = getSetting(db, user!.id, 'godMode.enabled') === 'true';

	// Count unpaid expenses for sidebar badge
	const unpaidExpenses = listExpenses(db, user!.id, { status: 'unpaid', limit: 1000 });

	return {
		godMode,
		unpaidCount: unpaidExpenses.length
	};
};
