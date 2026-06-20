import type { LayoutServerLoad } from './$types.js';
import { db } from '$lib/server/db/client.js';
import { getSetting } from '$lib/server/settings.js';
import { countExpenses } from '$lib/server/queries/expenses.js';
import { ExpenseStatus } from '$lib/enums.js';
import { getUserNavOrder } from '$lib/server/navPreferences.js';

export const load: LayoutServerLoad = async ({ locals }) => {
	const godMode = getSetting(db, 'godMode.enabled') === 'true';

	const unpaidCount = countExpenses(db, { status: ExpenseStatus.Unpaid });

	const navItems = getUserNavOrder(db, locals.user!.id).filter(
		(item) => locals.isSuperuser || (locals.permissions?.[item.resource]?.view ?? false)
	);

	return {
		user: locals.user,
		godMode,
		unpaidCount,
		isSuperuser: locals.isSuperuser,
		permissions: locals.permissions,
		navItems
	};
};
