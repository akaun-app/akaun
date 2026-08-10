import { EPSILON, mainAmount } from './types.js';
import type { BankFacingItem, DriftEntry, DriftReport, ItemStateRow } from './types.js';

/**
 * Compare the value captured when items were cleared with their value now.
 *
 * Item ids are only unique within an item type, so the lookup deliberately
 * uses both fields. Rows without a cleared amount are annotation-only state
 * and have no baseline to compare.
 */
export function detectDrift(
	clearedRows: readonly ItemStateRow[],
	currentItems: readonly BankFacingItem[]
): DriftReport {
	const currentByKey = new Map(
		currentItems.map((item) => [itemKey(item.itemType, item.itemId), item] as const)
	);
	const changed: DriftEntry[] = [];
	const deleted: DriftEntry[] = [];

	for (const row of clearedRows) {
		if (row.clearedAmount === null) continue;

		const item = currentByKey.get(itemKey(row.itemType, row.itemId));
		if (!item) {
			deleted.push({
				itemType: row.itemType,
				itemId: row.itemId,
				clearedAmount: row.clearedAmount,
				currentAmount: null
			});
			continue;
		}

		const currentAmount = mainAmount(item);
		if (Math.abs(currentAmount - row.clearedAmount) > EPSILON) {
			changed.push({
				itemType: row.itemType,
				itemId: row.itemId,
				clearedAmount: row.clearedAmount,
				currentAmount
			});
		}
	}

	return { changed, deleted };
}

function itemKey(itemType: number, itemId: number): string {
	return `${itemType}:${itemId}`;
}
