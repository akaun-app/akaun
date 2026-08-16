import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { LedgerRecordKind } from '$lib/enums.js';

/**
 * Where a report row points, when it points anywhere.
 *
 * Every one of these is an in-app navigation to another feature's own URL, per
 * the relation-card contract (CLAUDE.md § Cross-Feature Relation Cards): a
 * report never renders another feature's detail sheet itself.
 */

/** Every movement on this account, with its running balance (FR-028). */
export function openAccountHistory(accountId: number): Promise<void> {
	return goto(resolve('/(app)/accounts/[id]', { id: String(accountId) }));
}

/** What a debt is: the invoice that raised it, or the record that recorded it. */
export type RecordRef = {
	kind: number;
	recordId: number;
	invoiceId: number | null;
};

/**
 * The record behind an outstanding debt, or null when it has no screen of its
 * own — a payment, a transfer or a journal entry has no list page to land on,
 * and a row that cannot go anywhere must not pretend it can.
 */
export function recordPathFor(item: RecordRef): string | null {
	if (item.invoiceId !== null) {
		return resolve('/(app)/invoices/[id]', { id: String(item.invoiceId) });
	}
	if (item.kind === LedgerRecordKind.Expense) {
		return resolve('/(app)/expenses/[id]', { id: String(item.recordId) });
	}
	if (item.kind === LedgerRecordKind.Income) {
		return resolve('/(app)/income/[id]', { id: String(item.recordId) });
	}
	return null;
}

/** Opens that record, and does nothing for one that has no screen of its own. */
export function openRecord(item: RecordRef): void {
	const path = recordPathFor(item);
	if (!path) return;
	// eslint-disable-next-line svelte/no-navigation-without-resolve -- recordPathFor returns a resolved route.
	goto(path);
}
