// FR-035: a closed session's history must say so when the ledger records it
// cleared have moved since. `reconciliation_item_state` deliberately has no FK
// to those records (research.md D-01), so the row survives a delete — that
// survival is the evidence these tests pin down.

import { describe, expect, it } from 'vitest';
import { ReconItemType } from '$lib/enums.js';
import type { ReconItemTypeCode } from '$lib/enums.js';
import type { BankFacingItem, ItemStateRow } from './types.js';
import { detectDrift } from './drift.js';

/**
 * An `ItemStateRow` with only the fields drift reads spelled out; everything
 * else takes an inert default so each test reads as just its own scenario.
 */
function clearedRow(fields: {
	itemType: ReconItemTypeCode;
	itemId: number;
	clearedAmount: number | null;
}): ItemStateRow {
	return {
		id: fields.itemId,
		itemType: fields.itemType,
		itemId: fields.itemId,
		clearedSessionId: fields.clearedAmount === null ? null : 1,
		clearedLineId: null,
		clearedAmount: fields.clearedAmount,
		clearedAt: fields.clearedAmount === null ? null : '2026-07-31 09:00:00',
		annotation: null,
		annotationSessionId: null,
		annotationNote: '',
		updatedBy: null,
		updatedAt: '2026-07-31 09:00:00'
	};
}

/** A bank-facing item as it exists *now*, at the exchange rate it carries now. */
function currentItem(fields: {
	itemType: ReconItemTypeCode;
	itemId: number;
	amount: number;
	exchangeRate?: number;
}): BankFacingItem {
	return {
		itemType: fields.itemType,
		itemId: fields.itemId,
		label: 'item',
		date: '2026-07-14',
		amount: fields.amount,
		exchangeRate: fields.exchangeRate ?? 1
	};
}

describe('detectDrift', () => {
	it('reports a cleared item whose current main-currency amount no longer equals cleared_amount', () => {
		const report = detectDrift(
			[clearedRow({ itemType: ReconItemType.Expense, itemId: 12, clearedAmount: 250 })],
			[currentItem({ itemType: ReconItemType.Expense, itemId: 12, amount: 310 })]
		);

		expect(report.changed).toEqual([
			{
				itemType: ReconItemType.Expense,
				itemId: 12,
				clearedAmount: 250,
				currentAmount: 310
			}
		]);
		expect(report.deleted).toEqual([]);
	});

	it('reports drift when only the exchange rate moved — the baseline is the main-currency value', () => {
		const report = detectDrift(
			[clearedRow({ itemType: ReconItemType.Income, itemId: 3, clearedAmount: 420 })],
			[currentItem({ itemType: ReconItemType.Income, itemId: 3, amount: 100, exchangeRate: 4.7 })]
		);

		expect(report.changed).toEqual([
			{ itemType: ReconItemType.Income, itemId: 3, clearedAmount: 420, currentAmount: 470 }
		]);
		expect(report.deleted).toEqual([]);
	});

	it('reports a cleared item that no longer exists under deleted, with a null current amount', () => {
		const report = detectDrift(
			[clearedRow({ itemType: ReconItemType.Claim, itemId: 8, clearedAmount: 99.5 })],
			[]
		);

		expect(report.deleted).toEqual([
			{ itemType: ReconItemType.Claim, itemId: 8, clearedAmount: 99.5, currentAmount: null }
		]);
		expect(report.changed).toEqual([]);
	});

	it('reports neither for an untouched session — every cleared item is still worth what it was', () => {
		const report = detectDrift(
			[
				clearedRow({ itemType: ReconItemType.Expense, itemId: 1, clearedAmount: 42.75 }),
				clearedRow({ itemType: ReconItemType.Claim, itemId: 2, clearedAmount: 1200 }),
				clearedRow({ itemType: ReconItemType.Income, itemId: 3, clearedAmount: 500 })
			],
			[
				currentItem({ itemType: ReconItemType.Expense, itemId: 1, amount: 42.75 }),
				currentItem({ itemType: ReconItemType.Claim, itemId: 2, amount: 1200 }),
				currentItem({ itemType: ReconItemType.Income, itemId: 3, amount: 500 })
			]
		);

		expect(report.changed).toEqual([]);
		expect(report.deleted).toEqual([]);
	});

	it('does not report float noise below the 0.005 epsilon as drift', () => {
		// 0.1 + 0.2 === 0.30000000000000004 in IEEE-754; `amount` is SQLite REAL,
		// so a value like this comes straight back out of the database.
		const report = detectDrift(
			[clearedRow({ itemType: ReconItemType.Expense, itemId: 5, clearedAmount: 0.1 + 0.2 })],
			[currentItem({ itemType: ReconItemType.Expense, itemId: 5, amount: 0.3 })]
		);

		expect(report.changed).toEqual([]);
		expect(report.deleted).toEqual([]);
	});

	it('reports a difference larger than the epsilon — a one-cent edit is real drift', () => {
		const report = detectDrift(
			[clearedRow({ itemType: ReconItemType.Expense, itemId: 5, clearedAmount: 20.0 })],
			[currentItem({ itemType: ReconItemType.Expense, itemId: 5, amount: 20.01 })]
		);

		expect(report.changed).toEqual([
			{ itemType: ReconItemType.Expense, itemId: 5, clearedAmount: 20.0, currentAmount: 20.01 }
		]);
		expect(report.deleted).toEqual([]);
	});

	it('matches on the (itemType, itemId) pair — the same id under another type is a different record', () => {
		// Expense 5 was cleared and has since been deleted. Claim 5 and income 5
		// are unrelated records that happen to share the id, one of which even
		// carries the cleared amount. Neither may stand in for the expense.
		const report = detectDrift(
			[clearedRow({ itemType: ReconItemType.Expense, itemId: 5, clearedAmount: 80 })],
			[
				currentItem({ itemType: ReconItemType.Claim, itemId: 5, amount: 80 }),
				currentItem({ itemType: ReconItemType.Income, itemId: 5, amount: 640 })
			]
		);

		expect(report.deleted).toEqual([
			{ itemType: ReconItemType.Expense, itemId: 5, clearedAmount: 80, currentAmount: null }
		]);
		expect(report.changed).toEqual([]);
	});

	it('leaves an unchanged item alone even when a same-id record of another type did change', () => {
		const report = detectDrift(
			[clearedRow({ itemType: ReconItemType.Expense, itemId: 5, clearedAmount: 80 })],
			[
				currentItem({ itemType: ReconItemType.Expense, itemId: 5, amount: 80 }),
				currentItem({ itemType: ReconItemType.Claim, itemId: 5, amount: 9999 })
			]
		);

		expect(report.changed).toEqual([]);
		expect(report.deleted).toEqual([]);
	});

	it('skips a row with a null cleared_amount — an annotation-only row was never cleared', () => {
		// A row can exist purely to carry a leftover annotation (data-model.md,
		// row lifecycle). It has no baseline, so it is not a cleared item and
		// cannot have drifted — even though its record is gone.
		const report = detectDrift(
			[clearedRow({ itemType: ReconItemType.Expense, itemId: 7, clearedAmount: null })],
			[]
		);

		expect(report.changed).toEqual([]);
		expect(report.deleted).toEqual([]);
	});

	it('separates changed from deleted across a mixed set of cleared items', () => {
		const report = detectDrift(
			[
				clearedRow({ itemType: ReconItemType.Expense, itemId: 1, clearedAmount: 10 }),
				clearedRow({ itemType: ReconItemType.Expense, itemId: 2, clearedAmount: 20 }),
				clearedRow({ itemType: ReconItemType.Claim, itemId: 3, clearedAmount: 30 })
			],
			[
				currentItem({ itemType: ReconItemType.Expense, itemId: 1, amount: 10 }),
				currentItem({ itemType: ReconItemType.Expense, itemId: 2, amount: 25 })
			]
		);

		expect(report.changed).toEqual([
			{ itemType: ReconItemType.Expense, itemId: 2, clearedAmount: 20, currentAmount: 25 }
		]);
		expect(report.deleted).toEqual([
			{ itemType: ReconItemType.Claim, itemId: 3, clearedAmount: 30, currentAmount: null }
		]);
	});
});
