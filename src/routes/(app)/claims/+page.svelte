<script lang="ts">
	import { enhance } from '$app/forms';
	import { onMount, onDestroy } from 'svelte';
	import { fly } from 'svelte/transition';
	import { Plus, X, Search, ChevronRight, Clock, CheckCircle, FileText, Calendar, Paperclip, Upload } from '@lucide/svelte';
	import DatePicker from '$lib/components/ui/date-picker/DatePicker.svelte';
	import { formatMoney, formatMoneyRM, formatDate, formatDateShort } from '$lib/format.js';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import type { PageData } from './$types.js';

	let { data }: { data: PageData } = $props();

	type ClaimRow = (typeof data.claims)[0];
	type Attachment = { id: number; filename: string; displayName: string; addedDate: string };
	type FullClaim = ClaimRow & { attachments: Attachment[] };

	// Local reactive list — updated by SSE events and re-synced when SvelteKit reloads SSR data
	let claims = $state(data.claims);
	$effect(() => { claims = data.claims; });

	// --- State ---
	let activeTab = $state<'all' | 'pending' | 'done'>('all');
	let searchRaw = $state('');
	let search = $state('');
	let mobileSearchOpen = $state(false);
	let mobileSearchEl = $state<HTMLInputElement | null>(null);
	let detailClaim = $state<FullClaim | null>(null);
	let showNew = $state(false);
	let claimDrag = $state(false);
	let claimFileInput = $state<HTMLInputElement | null>(null);
	let newSelIds = $state(new Set<number>());
	let newClaimFiles = $state<File[]>([]);
	let newClaimDrag = $state(false);
	let newClaimFileInput = $state<HTMLInputElement | null>(null);

	// --- Derived ---
	const counts = $derived({
		all: claims.length,
		pending: claims.filter((c) => c.status === 'pending').length,
		done: claims.filter((c) => c.status === 'done').length
	});

	const totals = $derived({
		pending: claims.filter((c) => c.status === 'pending').reduce((s, c) => s + c.total, 0),
		done: claims.filter((c) => c.status === 'done').reduce((s, c) => s + c.total, 0),
		all: claims.reduce((s, c) => s + c.total, 0)
	});

	const displayed = $derived.by(() => {
		const list = (activeTab === 'all' ? claims.slice() : claims.filter((c) => c.status === activeTab))
			.filter((c) => search === '' || c.claimNumber.toLowerCase().includes(search));
		return list.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id));
	});

	// Search debounce
	$effect(() => {
		const v = searchRaw.trim().toLowerCase();
		const t = setTimeout(() => (search = v), 300);
		return () => clearTimeout(t);
	});
	$effect(() => { if (mobileSearchOpen && mobileSearchEl) mobileSearchEl.focus(); });

	const newSelList = $derived(data.unpaidExpenses.filter((e) => newSelIds.has(e.id)));
	const newTotal = $derived(newSelList.reduce((s, e) => s + e.amount, 0));

	// SSE — real-time updates from server
	let _es: EventSource | null = null;
	onMount(() => {
		_es = new EventSource('/api/claims/stream');
		_es.onmessage = (e) => {
			const msg = JSON.parse(e.data);
			if (msg.type === 'claim-update') mergeClaims([msg.item]);
			else if (msg.type === 'claim-delete') claims = claims.filter((c) => c.id !== msg.id);
		};
	});
	onDestroy(() => _es?.close());

	function mergeClaims(incoming: typeof data.claims) {
		const byId = new Map(incoming.map((c) => [c.id, c]));
		const existingIds = new Set(claims.map((c) => c.id));
		claims = claims.map((local) => byId.get(local.id) ?? local);
		const brandNew = incoming.filter((c) => !existingIds.has(c.id));
		if (brandNew.length > 0) claims = [...brandNew, ...claims];
	}

	// --- Actions ---
	async function openDetail(id: number) {
		const found = claims.find((c) => c.id === id);
		if (!found) return;
		detailClaim = { ...found, attachments: [] };
		const res = await fetch(`/api/claims/${id}`);
		if (res.ok) detailClaim = await res.json();
	}

	async function uploadClaimFiles(files: FileList) {
		if (!detailClaim) return;
		for (const file of Array.from(files)) {
			const fd = new FormData();
			fd.append('file', file);
			const res = await fetch(`/api/claims/${detailClaim.id}/attachments`, { method: 'POST', body: fd });
			if (res.ok) {
				const att: Attachment = await res.json();
				detailClaim = { ...detailClaim, attachments: [...detailClaim.attachments, att] };
			}
		}
	}

	async function deleteClaimAttachment(attachmentId: number) {
		if (!detailClaim) return;
		await fetch(`/api/claims/${detailClaim.id}/attachments/${attachmentId}`, { method: 'DELETE' });
		detailClaim = { ...detailClaim, attachments: detailClaim.attachments.filter((a) => a.id !== attachmentId) };
	}

	function handleClaimDrop(e: DragEvent) {
		e.preventDefault(); claimDrag = false;
		if (e.dataTransfer?.files) uploadClaimFiles(e.dataTransfer.files);
	}
	function handleClaimFileInput(e: Event) {
		const input = e.target as HTMLInputElement;
		if (input.files) uploadClaimFiles(input.files);
		input.value = '';
	}

	function toggleNewSel(id: number) {
		if (newSelIds.has(id)) newSelIds.delete(id);
		else newSelIds.add(id);
		newSelIds = new Set(newSelIds);
	}

	function closeNewSheet() {
		showNew = false;
		newSelIds = new Set();
		newClaimFiles = [];
	}
</script>

<svelte:head>
	<title>Claims - Akaun</title>
</svelte:head>

<div class="screen">
	<!-- Topbar -->
	<header class="topbar">
		<div class="topbar-left">
			<h1 class="page-title">Claims</h1>
			<p class="page-sub">
				{counts.all} reimbursement claim{counts.all !== 1 ? 's' : ''} · <span class="num"
					>{formatMoneyRM(totals.pending)}</span
				> awaiting
			</p>
		</div>
		<div class="topbar-right">
			<div class="search-box">
				<div style="position:relative; display:flex; align-items:center;">
					<span style="position:absolute; left:10px; color:var(--muted-foreground); display:flex; pointer-events:none;">
						<Search size={15} />
					</span>
					<input
						type="search"
						placeholder="Search claim number…"
						bind:value={searchRaw}
						style="width:100%; height:34px; border:1px solid var(--input); background:var(--card); color:var(--foreground); border-radius:8px; padding:0 12px 0 32px; font-family:inherit; font-size:13px; outline:none; transition:border-color .12s, box-shadow .12s;"
						onfocus={(e) => { const el = e.currentTarget as HTMLInputElement; el.style.borderColor = 'var(--primary)'; el.style.boxShadow = '0 0 0 3px var(--primary-soft)'; }}
						onblur={(e) => { const el = e.currentTarget as HTMLInputElement; el.style.borderColor = ''; el.style.boxShadow = ''; }}
					/>
				</div>
			</div>
			{#if mobileSearchOpen}
				<div class="mobile-search-inline" transition:fly={{ x: 12, duration: 180 }}>
					<span class="mobile-search-inline-icon"><Search size={15} /></span>
					<input
						class="mobile-search-inline-input"
						type="search"
						placeholder="Search claim number…"
						bind:value={searchRaw}
						bind:this={mobileSearchEl}
					/>
				</div>
			{/if}
			<button
				class="mobile-search-toggle"
				class:active={mobileSearchOpen}
				onclick={() => { mobileSearchOpen = !mobileSearchOpen; if (!mobileSearchOpen) searchRaw = ''; }}
			>
				{#if mobileSearchOpen}<X size={16} />{:else}<Search size={16} />{/if}
			</button>
			<button
				onclick={() => (showNew = true)}
				style="display:inline-flex; align-items:center; gap:6px; height:32px; padding:0 12px; background:var(--primary); color:var(--primary-foreground); border:none; border-radius:8px; font-family:inherit; font-size:13px; font-weight:500; cursor:pointer;"
			>
				<Plus size={15} /> <span class="btn-text">New claim</span>
			</button>
		</div>
	</header>

	<!-- Stat strip -->
	<div class="stat-strip" style="grid-template-columns:repeat(3,1fr);">
		<div class="stat-card tone-amber">
			<div class="stat-label">Awaiting reimbursement</div>
			<div class="stat-value"><span class="stat-cur">RM</span>{formatMoney(totals.pending)}</div>
			<div class="stat-sub">{counts.pending} pending claim{counts.pending !== 1 ? 's' : ''}</div>
		</div>
		<div class="stat-card tone-green">
			<div class="stat-label">Reimbursed</div>
			<div class="stat-value"><span class="stat-cur">RM</span>{formatMoney(totals.done)}</div>
			<div class="stat-sub">{counts.done} completed</div>
		</div>
		<div class="stat-card">
			<div class="stat-label">Total claimed</div>
			<div class="stat-value"><span class="stat-cur">RM</span>{formatMoney(totals.all)}</div>
			<div class="stat-sub">{counts.all} claim{counts.all !== 1 ? 's' : ''}</div>
		</div>
	</div>

	<!-- Work area -->
	<div class="work">
		<div class="work-main" style="padding-top:12px;">
			<!-- Toolbar -->
			<div class="toolbar">
				<div class="status-tabs">
					{#each [['all', 'All'], ['pending', 'Pending'], ['done', 'Claimed']] as [id, label]}
						<button
							class="status-tab"
							class:active={activeTab === id}
							onclick={() => (activeTab = id as typeof activeTab)}
						>
							{label}<span class="tab-count">{counts[id as keyof typeof counts]}</span>
						</button>
					{/each}
				</div>
			</div>

			<!-- Result meta -->
			{#if displayed.length > 0 || search !== ''}
			<div class="result-meta">
				<span>Showing <b>{displayed.length}</b> of {counts.all}</span>
			</div>
			{/if}

			<!-- Table -->
			<div class="table-card">
				<table class="exp-table">
					<thead>
						<tr>
							<th>Claim</th>
							<th>Date</th>
							<th>Status</th>
							<th>Expenses</th>
							<th class="ta-right">Total</th>
							<th style="width:40px;"></th>
						</tr>
					</thead>
					<tbody>
						{#each displayed as claim (claim.id)}
							<tr class="exp-row" onclick={() => openDetail(claim.id)}>
								<td class="td-primary">
									<div class="cell-item">
										<span class="cell-itemname">{claim.claimNumber}</span>
										<span class="cell-itemnum"
											>{claim.expenseCount} expense{claim.expenseCount !== 1 ? 's' : ''}</span
										>
									</div>
								</td>
								<td class="td-date" data-label="Date">{formatDate(claim.date)}</td>
								<td class="td-status" data-label="Status">
									<StatusBadge status={claim.status === 'done' ? 'claimed' : 'pending'} />
								</td>
								<td data-label="Expenses">
									<div class="claim-suppliers">
										{#each claim.suppliers.slice(0, 3) as s}
											<span class="chip">{s}</span>
										{/each}
										{#if claim.suppliers.length > 3}
											<span class="chip chip-muted">+{claim.suppliers.length - 3} more</span>
										{/if}
										{#if claim.suppliers.length === 0}
											<span style="color:var(--muted-foreground);">—</span>
										{/if}
									</div>
								</td>
								<td class="td-amount" data-label="Total">
									<span class="amount-num">{formatMoneyRM(claim.total)}</span>
								</td>
								<td class="td-chevron" style="text-align:right;">
									<ChevronRight size={16} style="color:var(--muted-foreground);" />
								</td>
							</tr>
						{/each}
						{#if displayed.length === 0}
							<tr class="empty-row">
								<td colspan="6">
									<div class="empty">
										<div class="empty-icon">
											{#if activeTab === 'pending'}
												<Clock size={20} />
											{:else if activeTab === 'done'}
												<CheckCircle size={20} />
											{:else}
												<FileText size={20} />
											{/if}
										</div>
										<div class="empty-title">
											{activeTab === 'pending'
												? 'No pending claims'
												: activeTab === 'done'
													? 'No completed claims'
													: 'No claims yet'}
										</div>
										<div class="empty-sub">
											{activeTab === 'pending'
												? 'Create a claim by selecting unpaid expenses'
												: activeTab === 'done'
													? 'Completed claims will appear here'
													: 'Create a claim from the Expenses page or using the New claim button above'}
										</div>
									</div>
								</td>
							</tr>
						{/if}
					</tbody>
				</table>
			</div>
			<div class="table-foot">
				<span>{displayed.length} of {counts.all} claims</span>
			</div>
		</div>
	</div>
</div>

<!-- Detail sheet -->
<Sheet.Root
	open={!!detailClaim}
	onOpenChange={(o) => {
		if (!o) detailClaim = null;
	}}
>
	<Sheet.Portal>
		<Sheet.Overlay />
		<Sheet.Content
			side="right"
			style="width:500px; max-width:95vw; display:flex; flex-direction:column; overflow:hidden;"
		>
			{#if detailClaim}
				<div
					style="display:flex; align-items:flex-start; justify-content:space-between; padding:22px 22px 16px; border-bottom:1px solid var(--border);"
				>
					<div>
						<div class="sheet-eyebrow"><FileText size={12} /> {detailClaim.claimNumber}</div>
						<div class="sheet-title-text">Reimbursement claim</div>
					</div>
					<Sheet.Close class="sheet-close">
						<X size={16} />
					</Sheet.Close>
				</div>
				<div style="flex:1; overflow-y:auto; padding:20px 22px;">
					<div class="detail-amount">
						<span class="detail-amount-cur">RM</span>
						<span class="detail-amount-val">{formatMoney(detailClaim.total)}</span>
					</div>
					<div class="detail-statusrow">
						<StatusBadge status={detailClaim.status === 'done' ? 'claimed' : 'pending'} />
						<span class="date-badge">
							<Calendar size={12} />
							{formatDate(detailClaim.date)}
						</span>
					</div>

					<div class="detail-section-label">
						Expenses in this claim ({detailClaim.expenses.length})
					</div>
					<div class="claim-exp-list">
						{#each detailClaim.expenses as e (e.id)}
							<div class="claim-exp">
								<div class="claim-exp-main">
									<div class="claim-exp-name">{e.itemName}</div>
									<div class="claim-exp-sub">
										{e.supplier ? e.supplier + ' · ' : ''}{e.expenseNumber}
									</div>
								</div>
								<StatusBadge status={e.status as 'unpaid' | 'pending' | 'paid'} />
								<div class="claim-exp-amt num">{formatMoney(e.amount)}</div>
							</div>
						{/each}
						{#if detailClaim.expenses.length === 0}
							<div
								style="color:var(--muted-foreground); font-size:13px; text-align:center; padding:16px;"
							>
								No expenses linked
							</div>
						{/if}
					</div>
					<div>
						<div class="attach-section-header">
							<div class="detail-section-label" style="margin:0;">Attachments</div>
							<button type="button" class="attach-add-btn" onclick={() => claimFileInput?.click()}>
								<Plus size={11} /> Add
							</button>
						</div>
						<div
							class="attach-drop-area"
							class:drag={claimDrag}
							ondragover={(e) => { e.preventDefault(); claimDrag = true; }}
							ondragleave={() => (claimDrag = false)}
							ondrop={handleClaimDrop}
						>
							{#if detailClaim.attachments.length > 0}
								<div class="attach-list">
									{#each detailClaim.attachments as att (att.id)}
										<div class="attach-item">
											<div class="attach-thumb"><Paperclip size={14} /></div>
											<div class="attach-meta">
												<a href="/api/files/{att.filename}" target="_blank" rel="noopener" class="attach-name attach-link">{att.displayName}</a>
												<div class="attach-sub">{att.addedDate}</div>
											</div>
											<button type="button" class="attach-del" onclick={() => deleteClaimAttachment(att.id)}>
												<X size={14} />
											</button>
										</div>
									{/each}
								</div>
							{:else}
								<div class="attach-empty attach-empty-drop" onclick={() => claimFileInput?.click()}>
									<Paperclip size={14} /> Drop files here or click to add
								</div>
							{/if}
						</div>
						<input bind:this={claimFileInput} type="file" accept=".pdf,.jpg,.jpeg,.png"
							multiple style="display:none" onchange={handleClaimFileInput} />
					</div>
				</div>
				<div class="sheet-foot">
					<div class="sheet-foot-note">
						{detailClaim.status === 'pending'
							? 'Marking as claimed sets all linked expenses to paid. Deleting reverts them to unpaid.'
							: 'All expenses in this claim are reimbursed and locked.'}
					</div>
					<div class="sheet-foot-actions">
						<form
							method="POST"
							action="?/delete"
							use:enhance={() =>
								async ({ result, update }) => {
									if (result.type === 'success') detailClaim = null;
									await update();
								}}
						>
							<input type="hidden" name="id" value={detailClaim.id} />
							<button
								type="submit"
								style="display:inline-flex; align-items:center; gap:6px; height:34px; padding:0 12px; border:1px solid var(--border); background:var(--card); color:var(--foreground); border-radius:8px; font-family:inherit; font-size:13px; cursor:pointer;"
							>
								Delete
							</button>
						</form>
						<form
							method="POST"
							action="?/markDone"
							use:enhance={() =>
								async ({ result, update }) => {
									if (result.type === 'success') detailClaim = null;
									await update();
								}}
						>
							<input type="hidden" name="id" value={detailClaim.id} />
							<button
								type="submit"
								disabled={detailClaim.status === 'done'}
								style="display:inline-flex; align-items:center; gap:6px; height:34px; padding:0 14px; background:var(--primary); color:var(--primary-foreground); border:none; border-radius:8px; font-family:inherit; font-size:13px; font-weight:500; cursor:pointer; opacity:{detailClaim.status === 'done' ? 0.5 : 1};"
							>
								<CheckCircle size={14} />
								{detailClaim.status === 'done' ? 'Claimed' : 'Mark as claimed'}
							</button>
						</form>
					</div>
				</div>
			{/if}
		</Sheet.Content>
	</Sheet.Portal>
</Sheet.Root>

<!-- New claim sheet -->
<Sheet.Root bind:open={showNew}>
	<Sheet.Portal>
		<Sheet.Overlay />
		<Sheet.Content
			side="right"
			style="width:480px; max-width:95vw; display:flex; flex-direction:column; overflow:hidden;"
		>
			<div
				style="display:flex; align-items:flex-start; justify-content:space-between; padding:22px 22px 16px; border-bottom:1px solid var(--border);"
			>
				<div>
					<div class="sheet-eyebrow">New</div>
					<div class="sheet-title-text">Create claim</div>
				</div>
				<button onclick={closeNewSheet} class="sheet-close">
					<X size={16} />
				</button>
			</div>
			<form
				method="POST"
				action="?/create"
				use:enhance={() =>
					async ({ result, update }) => {
						if (result.type === 'success') {
							if (newClaimFiles.length > 0) {
								const id = (result.data as Record<string, unknown>)?.id as number | undefined;
								if (id) {
									for (const file of newClaimFiles) {
										const fd = new FormData();
										fd.append('file', file);
										await fetch(`/api/claims/${id}/attachments`, { method: 'POST', body: fd });
									}
								}
							}
							closeNewSheet();
						}
						await update();
					}}
				style="flex:1; overflow-y:auto; padding:20px 22px; display:flex; flex-direction:column; gap:0;"
			>
				<div class="field">
					<label class="field-label" for="claimDate">Claim date *</label>
					<DatePicker name="date" defaultToday />
				</div>

				<div class="field">
					<div class="field-label">
						<span>Select expenses *</span>
						{#if newSelIds.size > 0}
							<span style="font-size:12px; color:var(--primary); font-weight:500;">
								{newSelIds.size} selected · RM {formatMoney(newTotal)}
							</span>
						{/if}
					</div>
					{#if data.unpaidExpenses.length === 0}
						<div
							style="color:var(--muted-foreground); font-size:13px; padding:16px; border:1px dashed var(--border); border-radius:8px; text-align:center;"
						>
							No unpaid expenses available
						</div>
					{:else}
						<div
							style="border:1px solid var(--border); border-radius:8px; overflow:hidden; max-height:320px; overflow-y:auto;"
						>
							{#each data.unpaidExpenses as e}
								<button
									type="button"
									onclick={() => toggleNewSel(e.id)}
									style="display:flex; align-items:center; gap:12px; padding:11px 14px; border-bottom:1px solid var(--border); cursor:pointer; width:100%; text-align:left; border-left:none; border-right:none; border-top:none; background:{newSelIds.has(e.id) ? 'var(--primary-soft)' : 'var(--card)'}; font-family:inherit; transition:background .1s;"
								>
									<span
										style="width:17px; height:17px; border-radius:5px; border:1.5px solid {newSelIds.has(e.id) ? 'var(--primary)' : 'var(--border-strong)'}; background:{newSelIds.has(e.id) ? 'var(--primary)' : 'var(--card)'}; display:grid; place-items:center; flex-shrink:0;"
									>
										{#if newSelIds.has(e.id)}<svg
												width="10"
												height="10"
												viewBox="0 0 24 24"
												fill="none"
												stroke="white"
												stroke-width="3"
												><path d="M20 6 9 17l-5-5" /></svg
											>{/if}
									</span>
									<div style="flex:1; min-width:0;">
										<div style="font-size:13px; font-weight:500; color:var(--foreground);"
											>{e.itemName}</div
										>
										<div style="font-size:11.5px; color:var(--muted-foreground);">
											{e.expenseNumber}{e.supplier ? ' · ' + e.supplier : ''} · {formatDateShort(
												e.date
											)}
										</div>
									</div>
									<div
										style="font-size:13px; font-weight:600; font-family:'Geist Mono',monospace; white-space:nowrap; color:var(--foreground);"
									>
										RM {formatMoney(e.amount)}
									</div>
								</button>
							{/each}
						</div>
					{/if}
				</div>

				<input type="hidden" name="expenseIds" value={[...newSelIds].join(',')} />

				<div class="field">
					<label class="field-label">Attachments <span style="font-weight:400; color:var(--muted-foreground);">optional</span></label>
					{#if newClaimFiles.length > 0}
						<div class="attach-list" style="margin-bottom:8px;">
							{#each newClaimFiles as file, i}
								<div class="attach-item">
									<div class="attach-thumb"><Paperclip size={14} /></div>
									<div class="attach-meta">
										<div class="attach-name">{file.name}</div>
										<div class="attach-sub">{(file.size / 1024).toFixed(0)} KB</div>
									</div>
									<button type="button" class="attach-del" onclick={() => (newClaimFiles = newClaimFiles.filter((_, j) => j !== i))}>
										<X size={14} />
									</button>
								</div>
							{/each}
						</div>
					{/if}
					<div
						class="attach-drop-area"
						class:drag={newClaimDrag}
						ondragover={(e) => { e.preventDefault(); newClaimDrag = true; }}
						ondragleave={() => (newClaimDrag = false)}
						ondrop={(e) => { e.preventDefault(); newClaimDrag = false; if (e.dataTransfer?.files) newClaimFiles = [...newClaimFiles, ...Array.from(e.dataTransfer.files)]; }}
						onclick={() => newClaimFileInput?.click()}
					>
						<div class="attach-empty attach-empty-drop" style="pointer-events:none;">
							<Upload size={14} /> Drop files here or click to browse
						</div>
					</div>
					<input bind:this={newClaimFileInput} type="file" accept=".pdf,.jpg,.jpeg,.png" multiple style="display:none"
						onchange={(e) => { const f = (e.target as HTMLInputElement).files; if (f) newClaimFiles = [...newClaimFiles, ...Array.from(f)]; (e.target as HTMLInputElement).value = ''; }} />
				</div>

				<div
					style="border-top:1px solid var(--border); padding-top:14px; display:flex; justify-content:flex-end; gap:9px; margin-top:auto;"
				>
					<button
						type="button"
						onclick={closeNewSheet}
						style="height:34px; padding:0 14px; border:1px solid var(--border); background:var(--card); color:var(--foreground); border-radius:8px; font-family:inherit; font-size:13px; cursor:pointer;"
					>
						Cancel
					</button>
					<button
						type="submit"
						disabled={newSelIds.size === 0}
						style="height:34px; padding:0 14px; background:var(--primary); color:var(--primary-foreground); border:none; border-radius:8px; font-family:inherit; font-size:13px; font-weight:500; cursor:{newSelIds.size === 0 ? 'not-allowed' : 'pointer'}; opacity:{newSelIds.size === 0 ? 0.5 : 1};"
					>
						Create claim
					</button>
				</div>
			</form>
		</Sheet.Content>
	</Sheet.Portal>
</Sheet.Root>

<style>
	.claim-suppliers {
		display: flex;
		gap: 5px;
		flex-wrap: wrap;
		align-items: center;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		font-size: 11.5px;
		background: var(--secondary);
		color: var(--secondary-foreground);
		padding: 2px 8px;
		border-radius: 6px;
		white-space: nowrap;
	}
	.chip-muted {
		color: var(--muted-foreground);
		background: transparent;
	}
	.date-badge {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 12px;
		color: var(--muted-foreground);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 2px 9px;
	}
	.sheet-foot {
		border-top: 1px solid var(--border);
		padding: 16px 22px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.sheet-foot-note {
		font-size: 12px;
		color: var(--muted-foreground);
	}
	.sheet-foot-actions {
		display: flex;
		gap: 8px;
		justify-content: flex-end;
	}
	.empty-sub {
		font-size: 13px;
		color: var(--muted-foreground);
		text-align: center;
		max-width: 320px;
	}
</style>
