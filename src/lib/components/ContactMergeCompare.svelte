<script lang="ts">
	import { enhance } from '$app/forms';
	import { formatDate } from '$lib/format.js';

	type CompareContact = {
		id: number;
		legalName: string;
		entityTypeLabel: string | null;
		roleLabels: string[];
		registrationNo: string | null;
		email: string | null;
		phone: string | null;
		address: string | null;
		remark: string | null;
		createdAt: string;
		usage?: { expenses: number; incomes: number };
	};

	let {
		contacts,
		formAction,
		onMerged
	}: {
		contacts: CompareContact[];
		formAction: string;
		onMerged?: () => void;
	} = $props();

	const uid = $props.id();
	const groupName = `survivor-${uid}`;

	let survivorId = $state<number | null>(null);
	let lastIds = $state('');
	$effect(() => {
		const ids = contacts.map((c) => c.id).join(',');
		if (ids !== lastIds) {
			lastIds = ids;
			survivorId = null;
		}
	});

	type Row = { label: string; value: (c: CompareContact) => string };
	const rows: Row[] = [
		{ label: 'Type', value: (c) => c.entityTypeLabel ?? '—' },
		{ label: 'Roles', value: (c) => (c.roleLabels.length ? c.roleLabels.join(', ') : '—') },
		{ label: 'Registration No.', value: (c) => c.registrationNo ?? '—' },
		{ label: 'Email', value: (c) => c.email ?? '—' },
		{ label: 'Phone', value: (c) => c.phone ?? '—' },
		{ label: 'Address', value: (c) => c.address ?? '—' },
		{ label: 'Remark', value: (c) => c.remark ?? '—' },
		{ label: 'Created', value: (c) => formatDate(c.createdAt) },
		{
			label: 'Usage',
			value: (c) =>
				c.usage ? `${c.usage.expenses} expense(s), ${c.usage.incomes} income(s)` : '—'
		}
	];

	function rowDiffers(row: Row): boolean {
		const values = contacts.map((c) => row.value(c));
		return values.some((v) => v !== values[0]);
	}

	const survivor = $derived(contacts.find((c) => c.id === survivorId) ?? null);
	const losers = $derived(contacts.filter((c) => c.id !== survivorId));
	const loserUsageTotal = $derived(
		losers.reduce(
			(acc, c) => ({
				expenses: acc.expenses + (c.usage?.expenses ?? 0),
				incomes: acc.incomes + (c.usage?.incomes ?? 0)
			}),
			{ expenses: 0, incomes: 0 }
		)
	);

	const loserIds = $derived(losers.map((c) => c.id));
</script>

<div class="merge-compare">
	<div class="merge-grid" style="grid-template-columns: 140px repeat({contacts.length}, minmax(140px, 1fr));">
		<div class="merge-cell merge-cell-label"></div>
		{#each contacts as c (c.id)}
			<label class="merge-cell merge-cell-radio">
				<input
					type="radio"
					name={groupName}
					value={c.id}
					checked={survivorId === c.id}
					onchange={() => (survivorId = c.id)}
				/>
				<span class="merge-radio-name">{c.legalName}</span>
				<span class="merge-radio-id">#{c.id}</span>
			</label>
		{/each}

		{#each rows as row (row.label)}
			<div class="merge-cell merge-cell-label">{row.label}</div>
			{#each contacts as c (c.id)}
				<div class="merge-cell" class:diff={rowDiffers(row)}>{row.value(c)}</div>
			{/each}
		{/each}
	</div>

	{#if survivor}
		<div class="merge-summary">
			<b>{survivor.legalName}</b> will be kept.
			{#if losers.length > 0}
				<b>{losers.map((c) => c.legalName).join(', ')}</b> will be permanently deleted.
				{#if loserUsageTotal.expenses > 0 || loserUsageTotal.incomes > 0}
					{loserUsageTotal.expenses} expense(s) and {loserUsageTotal.incomes} income(s) will be
					relinked to <b>{survivor.legalName}</b>.
				{/if}
			{/if}
		</div>
	{/if}

	<form
		method="POST"
		action={formAction}
		use:enhance={() => async ({ result, update }) => {
			if (result.type === 'success') onMerged?.();
			await update();
		}}
	>
		<input type="hidden" name="survivorId" value={survivorId ?? ''} />
		<input type="hidden" name="loserIds" value={loserIds.join(',')} />
		<button
			type="submit"
			class="merge-submit"
			disabled={!survivorId || contacts.length < 2}
			style="opacity:{!survivorId || contacts.length < 2 ? 0.5 : 1};"
		>
			Merge into selected
		</button>
	</form>
</div>

<style>
	.merge-compare { border: 1px solid var(--border); border-radius: var(--radius); padding: 14px; margin-bottom: 12px; }
	.merge-grid {
		display: grid;
		row-gap: 2px;
		column-gap: 8px;
		overflow-x: auto;
		font-size: 13px;
		padding-bottom: 10px;
		margin-bottom: 8px;
	}
	.merge-cell { padding: 6px 8px; display: flex; align-items: center; min-width: 0; }
	.merge-cell-label { color: var(--muted-foreground); font-size: 12px; font-weight: 500; }
	.merge-cell.diff { background: var(--amber-soft); border-radius: 6px; }
	.merge-cell-radio { display: flex; align-items: center; gap: 6px; cursor: pointer; padding: 6px 8px; border-bottom: 1px solid var(--border); margin-bottom: 4px; min-width: 44px; min-height: 44px; }
	.merge-radio-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.merge-radio-id { color: var(--muted-foreground); font-size: 11.5px; flex-shrink: 0; }
	.merge-summary { font-size: 12.5px; color: var(--muted-foreground); margin-top: 10px; line-height: 1.5; }
	.merge-submit {
		display: inline-flex; align-items: center; height: 32px; padding: 0 12px;
		background: var(--primary); color: var(--primary-foreground); border: none;
		border-radius: 8px; font-family: inherit; font-size: 13px; font-weight: 500;
		cursor: pointer; margin-top: 10px;
	}
</style>
