<script lang="ts">
	import { ExpenseStatus } from '$lib/enums.js';

	type Tone = { label: string; tone: string };
	// Accepts either an ExpenseStatus INT code (expenses) or a string label.
	// Claims pass 'claimed'/'pending' strings (their codes collide with expense codes).
	let { status }: { status: number | string } = $props();

	const byCode: Record<number, Tone> = {
		[ExpenseStatus.Unpaid]: { label: 'Unpaid', tone: 'red' },
		[ExpenseStatus.Pending]: { label: 'Pending', tone: 'amber' },
		[ExpenseStatus.Paid]: { label: 'Paid', tone: 'green' }
	};
	const byLabel: Record<string, Tone> = {
		unpaid: { label: 'Unpaid', tone: 'red' },
		pending: { label: 'Pending', tone: 'amber' },
		paid: { label: 'Paid', tone: 'green' },
		claimed: { label: 'Claimed', tone: 'green' },
		received: { label: 'Received', tone: 'green' },
		// Quotation statuses (labels from QuotationStatusLabels in enums.ts)
		draft: { label: 'Draft', tone: 'gray' },
		sent: { label: 'Sent', tone: 'amber' },
		accepted: { label: 'Accepted', tone: 'green' },
		declined: { label: 'Declined', tone: 'red' },
		converted: { label: 'Converted', tone: 'blue' },
		// Invoice-only
		cancelled: { label: 'Cancelled', tone: 'gray' },
		// Derived statuses (never stored, computed at read time)
		expired: { label: 'Expired', tone: 'amber' },
		overdue: { label: 'Overdue', tone: 'red' }
	};

	const m = $derived(
		typeof status === 'number'
			? (byCode[status] ?? byCode[ExpenseStatus.Unpaid])
			: (byLabel[status] ?? byLabel.unpaid)
	);
</script>

<span class="statusbadge tone-{m.tone}">
	<span class="statusdot"></span>{m.label}
</span>
