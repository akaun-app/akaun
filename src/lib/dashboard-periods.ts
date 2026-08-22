export type DashboardPeriod = 'm-2' | 'm-1' | 'm' | 'year';

const MONTH_NAMES = [
	'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

function pad(n: number): string {
	return String(n).padStart(2, '0');
}

/**
 * A date as the ledger stores it, in the **local** timezone.
 *
 * Local, not UTC: `ledger_records.date` is a plain calendar day the user typed,
 * so a UTC `toISOString()` would put "today" a day behind for anyone east of
 * Greenwich for part of every morning — and then the period figures and the
 * as-at-today figures on the same screen would disagree.
 */
export function toISODate(d: Date): string {
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function monthKey(d: Date): string {
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

function monthOffset(id: DashboardPeriod): number {
	return id === 'm-2' ? 2 : id === 'm-1' ? 1 : 0;
}

/** Period selector button ids + display labels, relative to `now`'s calendar month. */
export function periodOptions(now = new Date()): { id: DashboardPeriod; label: string }[] {
	const monthLabel = (offset: number) =>
		MONTH_NAMES[new Date(now.getFullYear(), now.getMonth() - offset, 1).getMonth()];
	return [
		{ id: 'm-2', label: monthLabel(2) },
		{ id: 'm-1', label: monthLabel(1) },
		{ id: 'm', label: monthLabel(0) },
		{ id: 'year', label: 'This year' }
	];
}

/** Inclusive [start, end] SQL date bounds for KPI totals + category breakdown. */
export function periodDateRange(id: DashboardPeriod, now = new Date()): { start: string; end: string } {
	if (id === 'year') return { start: `${now.getFullYear()}-01-01`, end: toISODate(now) };
	const offset = monthOffset(id);
	const monthStart = new Date(now.getFullYear(), now.getMonth() - offset, 1);
	const monthEnd = new Date(now.getFullYear(), now.getMonth() - offset + 1, 0);
	return { start: toISODate(monthStart), end: toISODate(monthEnd) };
}

/** 'YYYY-MM' keys to plot on the revenue-vs-expenses and profit-trend charts. */
export function periodMonthKeys(id: DashboardPeriod, now = new Date()): string[] {
	if (id === 'year') {
		const keys: string[] = [];
		for (let m = 0; m <= now.getMonth(); m++) keys.push(monthKey(new Date(now.getFullYear(), m, 1)));
		return keys;
	}
	const offset = monthOffset(id);
	return [monthKey(new Date(now.getFullYear(), now.getMonth() - offset, 1))];
}

export function isDashboardPeriod(v: string | null): v is DashboardPeriod {
	return v === 'm-2' || v === 'm-1' || v === 'm' || v === 'year';
}
