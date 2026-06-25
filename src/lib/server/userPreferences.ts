import { and, eq } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { userPreferences } from './db/schema.js';

export const USER_PREF_KEYS = {
	lastForeignCurrencyExpense: 'lastForeignCurrency.expense',
	lastForeignCurrencyIncome: 'lastForeignCurrency.income'
} as const;

export function getUserPreference(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	db: BunSQLiteDatabase<any>,
	userId: number,
	key: string
): string | null {
	const row = db
		.select({ value: userPreferences.value })
		.from(userPreferences)
		.where(and(eq(userPreferences.userId, userId), eq(userPreferences.key, key)))
		.get();
	return row?.value ?? null;
}

export function setUserPreference(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	db: BunSQLiteDatabase<any>,
	userId: number,
	key: string,
	value: string
): void {
	db.insert(userPreferences)
		.values({ userId, key, value })
		.onConflictDoUpdate({
			target: [userPreferences.userId, userPreferences.key],
			set: { value }
		})
		.run();
}
