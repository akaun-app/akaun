import type { PageServerLoad } from "./$types.js";
import { redirect } from "@sveltejs/kit";
import { db } from "$lib/server/db/client.js";
import {
  expenseTotals,
  incomeTotals,
  outstandingTotal,
  monthlyExpenseTotals,
  monthlyIncomeTotals,
  expenseCategoryBreakdown,
  recentExpenses,
  recentIncomes,
  currentAssetsAsAt,
  positionAsAt,
  fundsFlowStatement,
} from "$lib/server/queries/dashboard.js";
import { hasPermission } from "$lib/server/permissions.js";
import {
  periodDateRange,
  periodMonthKeys,
  isDashboardPeriod,
  toISODate,
} from "$lib/dashboard-periods.js";

export const load: PageServerLoad = async ({ locals, url }) => {
  if (!hasPermission(locals, "dashboard", "view"))
    throw redirect(302, "/settings");
  const requestedPeriod = url.searchParams.get("period");
  const period = isDashboardPeriod(requestedPeriod) ? requestedPeriod : "m";

  const now = new Date();
  const { start: periodStart, end: periodEnd } = periodDateRange(period, now);

  // Headline figures — SUM / COUNT computed in SQL.
  const exp = expenseTotals(db, periodStart, periodEnd);
  const inc = incomeTotals(db, periodStart, periodEnd);
  const outstanding = outstandingTotal(db);

  // Position as at today, not as at the period end: "what am I worth" is a
  // question about now, and a balance sheet dated last month would read as a
  // stale bank balance. The period selector governs the period figures only.
  const today = toISODate(now);
  const currentAssets = currentAssetsAsAt(db, today);
  const position = positionAsAt(db, today);

  // What moved the funds over the selected period, split by activity. This is
  // the one place capitalised equipment is visible on the dashboard.
  const fundsFlow = fundsFlowStatement(db, periodStart, periodEnd);

  // Month-series scoped to the selected period — one GROUP BY per table, looked up by month key.
  const months = periodMonthKeys(period, now);
  const monthLabels: Record<string, string> = {};
  months.forEach((m) => {
    const [y, mo] = m.split("-");
    const names = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    monthLabels[m] = names[parseInt(mo) - 1] + " " + y.slice(2);
  });
  const monthSeriesStart = months[0] + "-01";
  const expByMonth = monthlyExpenseTotals(db, monthSeriesStart);
  const incByMonth = monthlyIncomeTotals(db, monthSeriesStart);

  const cashFlow = months.map((m) => ({
    label: monthLabels[m],
    income: incByMonth[m] ?? 0,
    expense: expByMonth[m] ?? 0,
  }));
  const trendData = months.map((m) => ({
    label: monthLabels[m],
    value: (incByMonth[m] ?? 0) - (expByMonth[m] ?? 0),
  }));

  // Category breakdown for the period — GROUP BY category, top 6.
  const categoryData = expenseCategoryBreakdown(db, periodStart, periodEnd, 6);

  // Recent activity — 7 newest of each, merged and trimmed to 7.
  const recentEx = recentExpenses(db, 7).map((e) => ({
    kind: "expense" as const,
    date: e.date,
    name: e.name,
    sub: e.sub ?? "",
    amount: e.amount,
  }));
  const recentInc = recentIncomes(db, 7).map((i) => ({
    kind: "income" as const,
    date: i.date,
    name: i.name ?? "",
    sub: i.sub,
    amount: i.amount,
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
    currentAssets,
    position,
    fundsFlow,
    expCount: exp.count,
    incCount: inc.count,
    cashFlow,
    categoryData,
    trendData,
    recent,
  };
};
