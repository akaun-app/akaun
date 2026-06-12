<script lang="ts">
	type Status = 'unpaid' | 'pending' | 'paid' | 'claimed';
	let { status }: { status: Status } = $props();

	const meta: Record<Status, { label: string; tone: string }> = {
		unpaid: { label: 'Unpaid', tone: 'red' },
		pending: { label: 'Pending', tone: 'amber' },
		paid: { label: 'Paid', tone: 'green' },
		claimed: { label: 'Claimed', tone: 'green' }
	};
	const m = $derived(meta[status] ?? meta.unpaid);
</script>

<span class="statusbadge tone-{m.tone}">
	<span class="statusdot"></span>{m.label}
</span>
