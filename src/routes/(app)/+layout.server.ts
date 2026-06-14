import type { LayoutServerLoad } from './$types.js';
import { db } from '$lib/server/db/client.js';
import { getSetting } from '$lib/server/settings.js';
import { listExpenses } from '$lib/server/queries/expenses.js';

export const load: LayoutServerLoad = async ({ locals }) => {
	const user = locals.user;
	const godMode = getSetting(db, user!.id, 'godMode.enabled') === 'true';

	const unpaidExpenses = listExpenses(db, user!.id, { status: 'unpaid', limit: 1000 });

	return {
		user: locals.user,
		godMode,
		unpaidCount: unpaidExpenses.length,
		isSuperuser: locals.isSuperuser,
		permissions: locals.permissions
	};
};
