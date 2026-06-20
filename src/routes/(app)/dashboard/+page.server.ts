import type { PageServerLoad } from './$types.js';
import { redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db/client.js';
import {
	expenseTotals,
	incomeTotals,
	outstandingTotal,
	monthlyExpenseTotals,
	monthlyIncomeTotals,
	expenseCategoryBreakdown,
	recentExpenses,
	recentIncomes
} from '$lib/server/queries/dashboard.js';
import { hasPermission } from '$lib/server/permissions.js';

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
	if (!hasPermission(locals, 'dashboard', 'view')) throw redirect(302, '/settings');
	const period = url.searchParams.get('period') ?? '2m';

	const periodStart =
		period === 'ytd' ? startOfYear() : period === 'mtd' ? startOfMonth() : monthsAgo(2);
	const todayStr = today();

	// Headline figures — SUM / COUNT computed in SQL.
	const exp = expenseTotals(db, periodStart, todayStr);
	const inc = incomeTotals(db, periodStart, todayStr);
	const outstanding = outstandingTotal(db);

	// Last-6-months series — one GROUP BY per table, looked up by month key.
	const months = last6Months();
	const monthLabels: Record<string, string> = {};
	months.forEach((m) => {
		const [y, mo] = m.split('-');
		const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
		monthLabels[m] = names[parseInt(mo) - 1] + ' ' + y.slice(2);
	});
	const sixMonthsStart = months[0] + '-01';
	const expByMonth = monthlyExpenseTotals(db, sixMonthsStart);
	const incByMonth = monthlyIncomeTotals(db, sixMonthsStart);

	const cashFlow = months.map((m) => ({
		label: monthLabels[m],
		income: incByMonth[m] ?? 0,
		expense: expByMonth[m] ?? 0
	}));
	const trendData = months.map((m) => ({
		label: monthLabels[m],
		value: (incByMonth[m] ?? 0) - (expByMonth[m] ?? 0)
	}));

	// Category breakdown for the period — GROUP BY category, top 6.
	const categoryData = expenseCategoryBreakdown(db, periodStart, todayStr, 6);

	// Recent activity — 7 newest of each, merged and trimmed to 7.
	const recentEx = recentExpenses(db, 7).map((e) => ({
		kind: 'expense' as const,
		date: e.date,
		name: e.name,
		sub: e.sub ?? '',
		amount: e.amount,
		status: e.status
	}));
	const recentInc = recentIncomes(db, 7).map((i) => ({
		kind: 'income' as const,
		date: i.date,
		name: i.name ?? '',
		sub: i.sub,
		amount: i.amount,
		status: undefined
	}));
	const recent = [...recentEx, ...recentInc]
		.sort((a, b) => (a.date < b.date ? 1 : -1))
		.slice(0, 7);

	return {
		period,
		expTotal: exp.total,
		incTotal: inc.total,
		net: inc.total - exp.total,
		outstanding,
		expCount: exp.count,
		incCount: inc.count,
		cashFlow,
		categoryData,
		trendData,
		recent
	};
};
