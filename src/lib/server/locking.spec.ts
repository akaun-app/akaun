import { describe, expect, it } from 'vitest';
import { ClaimStatus } from '$lib/enums.js';
import { canEditAmount, canEditClaimData } from './locking.js';

describe('claim correction locking', () => {
	it('allows financial edits for an expense in a pending claim', () => {
		expect(canEditAmount({ claimId: 12, claimStatus: ClaimStatus.Pending })).toBe(true);
	});

	it('locks financial edits for an expense in a completed claim', () => {
		expect(canEditAmount({ claimId: 12, claimStatus: ClaimStatus.Done })).toBe(false);
	});

	it('unlocks claim data after its status returns to pending', () => {
		expect(canEditClaimData({ status: ClaimStatus.Pending })).toBe(true);
		expect(canEditClaimData({ status: ClaimStatus.Done })).toBe(false);
	});
});
