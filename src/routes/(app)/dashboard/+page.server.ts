import type { PageServerLoad } from './$types.js';
import { db } from '$lib/server/db/client.js';
import { expenses, incomes } from '$lib/server/db/schema.js';
import { eq, gte, lte, and } from 'drizzle-orm';

function today(): string {
	return new Date().toISOString().slice(0, 10);
}

function monthsAgo(n: number): string {
	const d = new Date();
	d.setMonth(d.getMonth() - n);
	d.setDate(1);
	return d.toISOString().slice(0, 10);
}

function startOfMonth(): string {
	const d = new Date();
	d.setDate(1);
	return d.toISOString().slice(0, 10);
}

function startOfYear(): string {
	return new Date().getFullYear() + '-01-01';
}

function last6Months(): string[] {
	const result: string[] = [];
	const now = new Date();
	for (let i = 5; i >= 0; i--) {
		const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
		result.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
	}
	return result;
}

export const load: PageServerLoad = async ({ locals, url }) => {
	const userId = locals.user!.id;
	const period = url.searchParams.get('period') ?? '2m';

	const periodStart =
		period === 'ytd' ? startOfYear() : period === 'mtd' ? startOfMonth() : monthsAgo(2);
	const todayStr = today();

	const allExpenses = db
		.select()
		.from(expenses)
		.where(eq(expenses.userId, userId))
		.all();

	const allIncomes = db
		.select()
		.from(incomes)
		.where(eq(incomes.userId, userId))
		.all();

	// Period totals
	const periodExpenses = allExpenses.filter(
		(e) => e.date >= periodStart && e.date <= todayStr
	);
	const periodIncomes = allIncomes.filter(
		(i) => i.date >= periodStart && i.date <= todayStr
	);
	const expTotal = periodExpenses.reduce((s, e) => s + e.amount, 0);
	const incTotal = periodIncomes.reduce((s, i) => s + i.amount, 0);
	const outstanding = allExpenses
		.filter((e) => e.status === 'unpaid')
		.reduce((s, e) => s + e.amount, 0);

	// Monthly cash flow (last 6 months)
	const months = last6Months();
	const monthLabels: Record<string, string> = {};
	months.forEach((m) => {
		const [y, mo] = m.split('-');
		const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
		monthLabels[m] = names[parseInt(mo) - 1] + ' ' + y.slice(2);
	});
	const cashFlow = months.map((m) => ({
		label: monthLabels[m],
		income: allIncomes.filter((i) => i.date.startsWith(m)).reduce((s, i) => s + i.amount, 0),
		expense: allExpenses.filter((e) => e.date.startsWith(m)).reduce((s, e) => s + e.amount, 0)
	}));

	// Category breakdown for period
	const catMap: Record<string, number> = {};
	periodExpenses.forEach((e) => {
		catMap[e.category] = (catMap[e.category] || 0) + e.amount;
	});
	const categoryData = Object.entries(catMap)
		.map(([label, value]) => ({ label, value }))
		.sort((a, b) => b.value - a.value)
		.slice(0, 6);

	// Net trend (last 6 months)
	const trendData = months.map((m) => ({
		label: monthLabels[m],
		value:
			allIncomes.filter((i) => i.date.startsWith(m)).reduce((s, i) => s + i.amount, 0) -
			allExpenses.filter((e) => e.date.startsWith(m)).reduce((s, e) => s + e.amount, 0)
	}));

	// Recent activity (last 7 items)
	const recentEx = allExpenses
		.slice()
		.sort((a, b) => (a.date < b.date ? 1 : -1))
		.slice(0, 7)
		.map((e) => ({
			kind: 'expense' as const,
			date: e.date,
			name: e.itemName,
			sub: e.supplier,
			amount: e.amount,
			status: e.status
		}));
	const recentInc = allIncomes
		.slice()
		.sort((a, b) => (a.date < b.date ? 1 : -1))
		.slice(0, 7)
		.map((i) => ({
			kind: 'income' as const,
			date: i.date,
			name: i.source,
			sub: i.descriptionText,
			amount: i.amount,
			status: undefined
		}));
	const recent = [...recentEx, ...recentInc]
		.sort((a, b) => (a.date < b.date ? 1 : -1))
		.slice(0, 7);

	return {
		period,
		expTotal,
		incTotal,
		net: incTotal - expTotal,
		outstanding,
		expCount: periodExpenses.length,
		incCount: periodIncomes.length,
		cashFlow,
		categoryData,
		trendData,
		recent
	};
};
