import type { PageServerLoad } from './$types.js';
import { db } from '$lib/server/db/client.js';
import { importQueue } from '$lib/server/db/schema.js';
import { getSetting, SETTING_KEYS } from '$lib/server/settings.js';
import { desc } from 'drizzle-orm';
import { redirect } from '@sveltejs/kit';
import { hasPermission } from '$lib/server/permissions.js';

const DEFAULT_EXPENSE_CATEGORIES = [
	'Food & Beverage',
	'Transport',
	'Accommodation',
	'Equipment',
	'Software & SaaS',
	'Office Supplies',
	'Marketing',
	'Professional Services',
	'Other'
];

const DEFAULT_INCOME_CATEGORIES = [
	'Client Project',
	'Product Sales',
	'Consulting',
	'Salary',
	'Investment',
	'Rental',
	'Other'
];

export const load: PageServerLoad = async ({ locals }) => {
	if (!hasPermission(locals, 'import', 'view')) throw redirect(302, '/dashboard');

	// Shared ledger — show every job.
	const jobs = db.select().from(importQueue).orderBy(desc(importQueue.createdAt)).all();

	const expCatRaw = getSetting(db, SETTING_KEYS.expenseCategories);
	const incCatRaw = getSetting(db, SETTING_KEYS.incomeCategories);
	const expenseCategories: string[] = expCatRaw ? JSON.parse(expCatRaw) : DEFAULT_EXPENSE_CATEGORIES;
	const incomeCategories: string[] = incCatRaw ? JSON.parse(incCatRaw) : DEFAULT_INCOME_CATEGORIES;

	return { jobs, expenseCategories, incomeCategories };
};
