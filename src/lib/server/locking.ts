export function canEditAmount(expense: { claimId: number | null }): boolean {
	return expense.claimId === null;
}

export function canEditDescriptive(
	expense: { claimId: number | null },
	godMode: boolean
): boolean {
	return expense.claimId === null || godMode;
}
