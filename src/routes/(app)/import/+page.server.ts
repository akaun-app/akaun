import type { PageServerLoad } from './$types.js';
import { db } from '$lib/server/db/client.js';
import { importQueue } from '$lib/server/db/schema.js';
import { getCategories } from '$lib/server/queries/categories.js';
import { desc } from 'drizzle-orm';
import { redirect } from '@sveltejs/kit';
import { hasPermission } from '$lib/server/permissions.js';

export const load: PageServerLoad = async ({ locals }) => {
	if (!hasPermission(locals, 'import', 'view')) throw redirect(302, '/dashboard');

	// Shared ledger — show every job.
	const jobs = db.select().from(importQueue).orderBy(desc(importQueue.createdAt)).all();

	const expenseCategories = getCategories(db, 'expense');
	const incomeCategories = getCategories(db, 'income');

	return { jobs, expenseCategories, incomeCategories };
};
