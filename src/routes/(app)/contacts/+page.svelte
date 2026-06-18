<script lang="ts">
	import { enhance } from '$app/forms';
	import { useIsMobile } from '$lib/hooks/useIsMobile.svelte.js';
	import { createResourceStream, mergeById } from '$lib/sse.js';
	import { fly } from 'svelte/transition';
	import { Plus, Search, X, Users, Merge, SlidersHorizontal, Building2, EyeOff } from '@lucide/svelte';
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import FilterDropdown from '$lib/components/ui/FilterDropdown.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { EntityType, Role, EntityTypeLabels, RoleLabels } from '$lib/enums.js';
	import type { PageData, ActionData } from './$types.js';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	type Contact = (typeof data.contacts)[0];

	// svelte-ignore state_referenced_locally
	let contacts = $state<Contact[]>(data.contacts);
	$effect(() => { contacts = data.contacts; });

	let searchRaw = $state('');
	let search = $state('');
	let roleFilter = $state<number | 0>(0);
	let entityFilter = $state<number | 0>(0);
	let showInactive = $state(false);

	// Mobile UI state
	let mobileSearchOpen = $state(false);
	let mobileSearchEl = $state<HTMLInputElement | null>(null);
	let mobileFilterOpen = $state(false);
	$effect(() => { if (mobileSearchOpen && mobileSearchEl) mobileSearchEl.focus(); });

	// Mobile panel detection — full-screen bottom sheet on mobile
	const screen = useIsMobile();
	const isMobile = $derived(screen.current);
	const panelSide = $derived(isMobile ? 'bottom' : 'right');

	$effect(() => {
		const v = searchRaw;
		const t = setTimeout(() => (search = v), 300);
		return () => clearTimeout(t);
	});

	const ROLE_OPTIONS = [Role.Customer, Role.Supplier, Role.Employee];

	const counts = $derived.by(() => {
		const base = showInactive ? contacts : contacts.filter((c) => c.isActive);
		return {
			all: base.length,
			customer: base.filter((c) => c.roles.includes(Role.Customer)).length,
			supplier: base.filter((c) => c.roles.includes(Role.Supplier)).length,
			employee: base.filter((c) => c.roles.includes(Role.Employee)).length,
		};
	});

	const filtered = $derived.by(() => {
		let rows = contacts.slice();
		if (!showInactive) rows = rows.filter((c) => c.isActive);
		if (entityFilter) rows = rows.filter((c) => c.entityType === entityFilter);
		if (roleFilter) rows = rows.filter((c) => c.roles.includes(roleFilter));
		if (search.trim()) {
			const q = search.toLowerCase();
			rows = rows.filter(
				(c) =>
					c.legalName.toLowerCase().includes(q) ||
					(c.email ?? '').toLowerCase().includes(q) ||
					(c.registrationNo ?? '').toLowerCase().includes(q)
			);
		}
		return rows.sort((a, b) => a.legalName.localeCompare(b.legalName));
	});

	const activeFilterCount = $derived(
		(entityFilter ? 1 : 0) + (showInactive ? 1 : 0) + (search.trim() ? 1 : 0)
	);

	function clearAllFilters() {
		roleFilter = 0;
		entityFilter = 0;
		showInactive = false;
		searchRaw = '';
	}

	// --- Create / edit sheet ---
	let showForm = $state(false);
	let editing = $state<Contact | null>(null);
	let fEntityType = $state<number | 0>(0);
	let fRoles = $state<number[]>([]);

	function openCreate() {
		editing = null;
		fEntityType = 0;
		fRoles = [];
		showForm = true;
	}
	function openEdit(c: Contact) {
		editing = c;
		fEntityType = c.entityType;
		fRoles = [...c.roles];
		showForm = true;
	}
	function toggleRole(r: number) {
		fRoles = fRoles.includes(r) ? fRoles.filter((x) => x !== r) : [...fRoles, r];
	}

	$effect(() => { if (form?.success) { showForm = false; showMerge = false; } });

	// --- Duplicates / merge ---
	type Cluster = { normalized: string; contacts: Contact[] };
	let showMerge = $state(false);
	let clusters = $state<Cluster[]>([]);
	let survivorByCluster = $state<Record<string, number>>({});

	async function loadDuplicates() {
		const res = await fetch('/api/contacts/duplicates');
		clusters = res.ok ? await res.json() : [];
		survivorByCluster = {};
		showMerge = true;
	}

	// --- SSE ---
	type ContactStreamMsg =
		| { type: 'contact-update'; item: Contact }
		| { type: 'contact-delete'; id: number };
	createResourceStream<ContactStreamMsg>('/api/contacts/stream', (msg) => {
		if (msg.type === 'contact-update') contacts = mergeById(contacts, [msg.item]);
		else if (msg.type === 'contact-delete') contacts = contacts.filter((c) => c.id !== msg.id);
	});
</script>

<svelte:head>
	<title>Contacts - Akaun</title>
</svelte:head>

<div class="screen" style="position:relative;">
	<!-- Top bar -->
	<header class="topbar">
		<div class="topbar-left">
			<h1 class="page-title">Contacts</h1>
			<p class="page-sub">{contacts.filter(c => c.isActive).length} active · {contacts.length} total</p>
		</div>
		<div class="topbar-right">
			<div class="search-box">
				<div style="position:relative; display:flex; align-items:center;">
					<span style="position:absolute; left:10px; color:var(--muted-foreground); display:flex; pointer-events:none;">
						<Search size={15} />
					</span>
					<Input
						type="search"
						placeholder="Search name, email, reg no…"
						bind:value={searchRaw}
						class="h-[34px] pl-8 text-[13px]"
					/>
				</div>
			</div>
			{#if mobileSearchOpen}
				<div class="mobile-search-inline" transition:fly={{ x: 12, duration: 180 }}>
					<span class="mobile-search-inline-icon"><Search size={15} /></span>
					<input
						class="mobile-search-inline-input"
						type="search"
						placeholder="Search name, email…"
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
			{#if data.perms.change && data.perms.delete}
				<Button variant="outline" size="sm" onclick={loadDuplicates}>
					<Merge size={14} /> <span class="btn-text">Find duplicates</span>
				</Button>
			{/if}
			{#if data.perms.add}
				<Button size="sm" onclick={openCreate}>
					<Plus size={15} /> <span class="btn-text">New contact</span>
				</Button>
			{/if}
		</div>
	</header>

	<div class="work">
		<div class="work-main layout-standard" style="padding-top:12px;">
			<!-- Toolbar -->
			<div class="toolbar">
				<div class="status-tabs">
					{#each [[0, 'All', counts.all], [Role.Customer, 'Customer', counts.customer], [Role.Supplier, 'Supplier', counts.supplier], [Role.Employee, 'Employee', counts.employee]] as [val, label, count]}
						<button
							class="status-tab"
							class:active={roleFilter === val}
							onclick={() => (roleFilter = val as number)}
						>
							{label}<span class="tab-count">{count}</span>
						</button>
					{/each}
				</div>
				<div class="mobile-filter-row">
					<button
						class="btn-outline btn-sm"
						style="display:inline-flex; align-items:center; gap:6px;"
						onclick={() => (mobileFilterOpen = true)}
					>
						<SlidersHorizontal size={13} /> Filters
						{#if activeFilterCount > 0}<span class="filter-count">{activeFilterCount}</span>{/if}
					</button>
					{#if activeFilterCount > 0}
						<button class="clear-filters" onclick={clearAllFilters}><X size={13} /> Clear</button>
					{/if}
				</div>
				<div class="toolbar-filters">
					{#if activeFilterCount > 0}
						<button class="clear-filters" onclick={clearAllFilters}><X size={13} /> Clear</button>
					{/if}
					<FilterDropdown label="Type" active={entityFilter !== 0} align="right">
						{#snippet icon()}<Building2 size={14} />{/snippet}
						<div style="padding:5px;">
							<div style="display:flex; align-items:center; justify-content:space-between; padding:6px 8px 8px; font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.04em; color:var(--muted-foreground);">
								<span>Entity type</span>
								{#if entityFilter !== 0}<button onclick={() => (entityFilter = 0)} style="border:none; background:none; color:var(--primary); cursor:pointer; font-size:11px; font-weight:600;">Clear</button>{/if}
							</div>
							{#each [[0, 'All types'], [EntityType.Individual, 'Individual'], [EntityType.Business, 'Business']] as [val, label]}
								<button
									onclick={() => (entityFilter = val as number)}
									style="display:flex; align-items:center; gap:9px; width:100%; border:none; background:none; font-family:inherit; font-size:13px; color:var(--foreground); padding:7px 8px; border-radius:7px; cursor:pointer; text-align:left;"
									onmouseover={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--accent)'; }}
									onmouseout={(e) => { (e.currentTarget as HTMLButtonElement).style.background = ''; }}
									onfocus={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--accent)'; }}
									onblur={(e) => { (e.currentTarget as HTMLButtonElement).style.background = ''; }}
								>
									<span style="width:16px; height:16px; border-radius:50%; border:1.5px solid {entityFilter === val ? 'var(--primary)' : 'var(--border-strong)'}; background:{entityFilter === val ? 'var(--primary)' : 'var(--card)'}; display:grid; place-items:center; flex-shrink:0;">
										{#if entityFilter === val}<span style="width:6px; height:6px; border-radius:50%; background:white; display:block;"></span>{/if}
									</span>
									{label}
								</button>
							{/each}
						</div>
					</FilterDropdown>

					<FilterDropdown label="Inactive" active={showInactive} align="right">
						{#snippet icon()}<EyeOff size={14} />{/snippet}
						<div style="padding:5px;">
							<div style="display:flex; align-items:center; justify-content:space-between; padding:6px 8px 8px; font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.04em; color:var(--muted-foreground);">
								<span>Visibility</span>
							</div>
							<button
								onclick={() => (showInactive = !showInactive)}
								style="display:flex; align-items:center; gap:9px; width:100%; border:none; background:none; font-family:inherit; font-size:13px; color:var(--foreground); padding:7px 8px; border-radius:7px; cursor:pointer; text-align:left;"
								onmouseover={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--accent)'; }}
								onmouseout={(e) => { (e.currentTarget as HTMLButtonElement).style.background = ''; }}
								onfocus={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--accent)'; }}
								onblur={(e) => { (e.currentTarget as HTMLButtonElement).style.background = ''; }}
							>
								<span style="width:16px; height:16px; border-radius:4px; border:1.5px solid {showInactive ? 'var(--primary)' : 'var(--border-strong)'}; background:{showInactive ? 'var(--primary)' : 'var(--card)'}; display:grid; place-items:center; flex-shrink:0;">
									{#if showInactive}<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>{/if}
								</span>
								Show inactive contacts
							</button>
						</div>
					</FilterDropdown>
				</div>
			</div>

			<!-- Result meta -->
			{#if filtered.length > 0 || activeFilterCount > 0}
			<div class="result-meta">
				<span>Showing <b>{filtered.length}</b> of {contacts.length}</span>
			</div>
			{/if}

			<!-- Table -->
			<div class="table-card">
				<table class="exp-table">
					<thead>
						<tr>
							<th>Name</th>
							<th>Type</th>
							<th>Roles</th>
							<th>Email</th>
							<th></th>
						</tr>
					</thead>
					<tbody>
						{#each filtered as c (c.id)}
							<tr class="exp-row" class:inactive={!c.isActive} onclick={() => { if (data.perms.change) openEdit(c); }}>
								<td class="td-primary" data-label="Name">
									<div class="cell-item">
										<span class="cell-itemname">{c.legalName}</span>
										{#if !c.isActive}<span class="cell-itemnum">inactive</span>{/if}
									</div>
								</td>
								<td data-label="Type" style="font-size:13px; color:var(--muted-foreground);">
									{EntityTypeLabels[c.entityType] ?? '—'}
								</td>
								<td data-label="Roles">
									{#if c.roles.length === 0}
										<span class="badge-warn">no roles</span>
									{:else}
										{#each c.roleLabels as rl}
											<span style="display:inline-flex; align-items:center; font-size:11.5px; background:var(--secondary); color:var(--secondary-foreground); padding:2px 9px; border-radius:999px; white-space:nowrap; margin-right:4px;">{rl}</span>
										{/each}
									{/if}
								</td>
								<td data-label="Email" style="color:var(--muted-foreground); font-size:13px;">{c.email ?? '—'}</td>
								<td class="td-actions" onclick={(ev) => ev.stopPropagation()}>
									{#if data.perms.delete && c.isActive}
										<form method="POST" action="?/deactivate" use:enhance style="display:inline">
											<input type="hidden" name="id" value={c.id} />
											<button class="link-danger" type="submit">Deactivate</button>
										</form>
									{/if}
								</td>
							</tr>
						{:else}
							<tr class="empty-row">
								<td colspan="5">
									<EmptyState
										title={activeFilterCount > 0 ? 'No contacts match your filters' : 'No contacts yet'}
										sub={activeFilterCount > 0 ? 'Try adjusting your search or filters.' : 'Your contacts will appear here.'}
									>
										{#snippet icon()}<Users size={20} />{/snippet}
										{#snippet action()}{#if activeFilterCount > 0}<button class="link-btn" onclick={clearAllFilters}>Clear filters</button>{/if}{/snippet}
									</EmptyState>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<div class="table-foot">
				<span>{filtered.length} of {contacts.length} contacts</span>
			</div>
		</div>
	</div>
</div>

<!-- Mobile filter sheet -->
<Sheet.Root bind:open={mobileFilterOpen}>
	<Sheet.Portal>
		<Sheet.Overlay />
		<Sheet.Content side="bottom" style="border-radius:16px 16px 0 0; max-height:85vh; overflow-y:auto; padding:20px 20px calc(20px + env(safe-area-inset-bottom));">
			<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px;">
				<div style="font-size:15px; font-weight:600;">Filters</div>
				<Sheet.Close class="sheet-close"><X size={16} /></Sheet.Close>
			</div>
			<div style="margin-bottom:16px;">
				<div style="font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.04em; color:var(--muted-foreground); margin-bottom:10px; display:flex; align-items:center; justify-content:space-between;">
					<span>Entity type</span>
					{#if entityFilter !== 0}<button onclick={() => (entityFilter = 0)} style="border:none; background:none; color:var(--primary); cursor:pointer; font-size:11px; font-weight:600;">Clear</button>{/if}
				</div>
				<div style="display:flex; flex-direction:column; gap:2px;">
					{#each [[0, 'All types'], [EntityType.Individual, 'Individual'], [EntityType.Business, 'Business']] as [val, label]}
						<button
							onclick={() => (entityFilter = val as number)}
							style="display:flex; align-items:center; gap:9px; width:100%; border:none; background:none; font-family:inherit; font-size:13px; color:var(--foreground); padding:8px 4px; border-radius:7px; cursor:pointer; text-align:left;"
							onmouseover={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--accent)'; }}
							onmouseout={(e) => { (e.currentTarget as HTMLButtonElement).style.background = ''; }}
							onfocus={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--accent)'; }}
							onblur={(e) => { (e.currentTarget as HTMLButtonElement).style.background = ''; }}
						>
							<span style="width:16px; height:16px; border-radius:50%; border:1.5px solid {entityFilter === val ? 'var(--primary)' : 'var(--border-strong)'}; background:{entityFilter === val ? 'var(--primary)' : 'var(--card)'}; display:grid; place-items:center; flex-shrink:0;">
								{#if entityFilter === val}<span style="width:6px; height:6px; border-radius:50%; background:white; display:block;"></span>{/if}
							</span>
							{label}
						</button>
					{/each}
				</div>
			</div>
			<div style="margin-bottom:20px;">
				<div style="font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.04em; color:var(--muted-foreground); margin-bottom:10px;">Visibility</div>
				<div style="display:flex; flex-wrap:wrap; gap:7px;">
					<button
						onclick={() => (showInactive = !showInactive)}
						style="border:1px solid {showInactive ? 'var(--primary)' : 'var(--border)'}; background:{showInactive ? 'var(--primary-soft)' : 'var(--card)'}; color:{showInactive ? 'var(--primary)' : 'var(--foreground)'}; font-family:inherit; font-size:13px; padding:5px 12px; border-radius:999px; cursor:pointer;"
					>Show inactive</button>
				</div>
			</div>
			<Button class="w-full" onclick={() => (mobileFilterOpen = false)}>
				Show results
			</Button>
		</Sheet.Content>
	</Sheet.Portal>
</Sheet.Root>

<!-- Create / edit sheet -->
<Sheet.Root open={showForm} onOpenChange={(o) => (showForm = o)}>
	<Sheet.Portal>
		<Sheet.Overlay />
		<Sheet.Content side={panelSide} style={isMobile ? 'height:100dvh; border-radius:0; border-top:none; display:flex; flex-direction:column; overflow:hidden;' : 'width:460px; max-width:95vw; display:flex; flex-direction:column; overflow:hidden;'}>
			<div style="display:flex; align-items:flex-start; justify-content:space-between; padding:22px 22px 16px; border-bottom:1px solid var(--border);">
				<div>
					<div class="sheet-eyebrow">{editing ? 'Edit' : 'New'}</div>
					<div class="sheet-title-text">{editing ? 'Edit contact' : 'Add contact'}</div>
				</div>
				<Sheet.Close class="sheet-close"><X size={16} /></Sheet.Close>
			</div>
			<div style="flex:1; overflow-y:auto; padding:20px 22px;">
				{#if form?.error}<div style="background:var(--red-soft); color:var(--red); border-radius:8px; padding:10px 14px; font-size:13px; margin-bottom:16px;">{form.error}</div>{/if}
				<form method="POST" action={editing ? '?/update' : '?/create'} use:enhance>
					{#if editing}<input type="hidden" name="id" value={editing.id} />{/if}

					<div class="field">
						<span class="field-label">Entity type *</span>
						<div style="display:flex; gap:8px; flex-wrap:wrap;">
							<label style="display:inline-flex; align-items:center; gap:6px; border:1px solid {fEntityType === EntityType.Individual ? 'var(--primary)' : 'var(--border)'}; border-radius:8px; padding:6px 12px; font-size:13px; cursor:pointer; background:{fEntityType === EntityType.Individual ? 'color-mix(in srgb, var(--primary) 10%, transparent)' : 'var(--card)'};">
								<input type="radio" name="entityType" value={EntityType.Individual} bind:group={fEntityType} style="display:none;" /> Individual
							</label>
							<label style="display:inline-flex; align-items:center; gap:6px; border:1px solid {fEntityType === EntityType.Business ? 'var(--primary)' : 'var(--border)'}; border-radius:8px; padding:6px 12px; font-size:13px; cursor:pointer; background:{fEntityType === EntityType.Business ? 'color-mix(in srgb, var(--primary) 10%, transparent)' : 'var(--card)'};">
								<input type="radio" name="entityType" value={EntityType.Business} bind:group={fEntityType} style="display:none;" /> Business
							</label>
						</div>
					</div>

					<div class="field">
						<label class="field-label" for="legalName">Legal name *</label>
						<Input id="legalName" name="legalName" required value={editing?.legalName ?? ''} class="w-full" />
					</div>

					<div class="field">
						<span class="field-label">Roles</span>
						<div style="display:flex; gap:8px; flex-wrap:wrap;">
							{#each ROLE_OPTIONS as r}
								<label style="display:inline-flex; align-items:center; gap:6px; border:1px solid {fRoles.includes(r) ? 'var(--primary)' : 'var(--border)'}; border-radius:8px; padding:6px 12px; font-size:13px; cursor:pointer; background:{fRoles.includes(r) ? 'color-mix(in srgb, var(--primary) 10%, transparent)' : 'var(--card)'};">
									<input type="checkbox" name="roles" value={r} checked={fRoles.includes(r)} onchange={() => toggleRole(r)} style="display:none;" />
									{RoleLabels[r]}
								</label>
							{/each}
						</div>
					</div>

					<div class="field">
						<label class="field-label" for="registrationNo">Registration no.</label>
						<Input id="registrationNo" name="registrationNo" value={editing?.registrationNo ?? ''} class="w-full" />
					</div>
					<div class="field">
						<label class="field-label" for="email">Email</label>
						<Input id="email" name="email" type="email" value={editing?.email ?? ''} class="w-full" />
					</div>
					<div class="field">
						<label class="field-label" for="phone">Phone</label>
						<Input id="phone" name="phone" value={editing?.phone ?? ''} class="w-full" />
					</div>
					<div class="field">
						<label class="field-label" for="address">Address</label>
						<Textarea id="address" name="address" rows={2} value={editing?.address ?? ''} class="leading-relaxed" />
					</div>
					<div class="field">
						<label class="field-label" for="remark">Remark</label>
						<Textarea id="remark" name="remark" rows={2} value={editing?.remark ?? ''} class="leading-relaxed" />
					</div>

					<div style="border-top:1px solid var(--border); padding-top:14px; display:flex; justify-content:flex-end; gap:9px; margin-top:8px;">
						<button type="button" onclick={() => (showForm = false)} style="height:34px; padding:0 14px; border:1px solid var(--border); background:var(--card); color:var(--foreground); border-radius:8px; font-family:inherit; font-size:13px; cursor:pointer;">
							Cancel
						</button>
						<button type="submit" disabled={!fEntityType} style="height:34px; padding:0 14px; background:var(--primary); color:var(--primary-foreground); border:none; border-radius:8px; font-family:inherit; font-size:13px; font-weight:500; cursor:pointer; opacity:{!fEntityType ? 0.5 : 1};">
							{editing ? 'Save changes' : 'Create contact'}
						</button>
					</div>
				</form>
			</div>
		</Sheet.Content>
	</Sheet.Portal>
</Sheet.Root>

<!-- Find duplicates / merge sheet -->
<Sheet.Root open={showMerge} onOpenChange={(o) => (showMerge = o)}>
	<Sheet.Portal>
		<Sheet.Overlay />
		<Sheet.Content side={panelSide} style={isMobile ? 'height:100dvh; border-radius:0; border-top:none; display:flex; flex-direction:column; overflow:hidden;' : 'width:500px; max-width:95vw; display:flex; flex-direction:column; overflow:hidden;'}>
			<div style="display:flex; align-items:flex-start; justify-content:space-between; padding:22px 22px 16px; border-bottom:1px solid var(--border);">
				<div>
					<div class="sheet-eyebrow">Contacts</div>
					<div class="sheet-title-text">Duplicate contacts</div>
				</div>
				<Sheet.Close class="sheet-close"><X size={16} /></Sheet.Close>
			</div>
			<div style="flex:1; overflow-y:auto; padding:20px 22px;">
				{#if clusters.length === 0}
					<EmptyState title="No duplicates found" sub="All your contacts appear to be unique." style="padding:40px 20px;">
						{#snippet icon()}<Users size={20} />{/snippet}
					</EmptyState>
				{/if}
				{#each clusters as cl}
					<div class="cluster">
						<div class="cluster-name">"{cl.normalized}"</div>
						<form method="POST" action="?/merge" use:enhance>
							{#each cl.contacts as c}
								<label class="cluster-row">
									<input type="radio" name="survivor-{cl.normalized}" value={c.id}
										onchange={() => (survivorByCluster[cl.normalized] = c.id)} />
									<span>{c.legalName} <span style="color:var(--muted-foreground);">#{c.id}</span></span>
								</label>
							{/each}
							<input type="hidden" name="survivorId" value={survivorByCluster[cl.normalized] ?? ''} />
							<input type="hidden" name="loserIds"
								value={cl.contacts.map((c) => c.id).filter((id) => id !== survivorByCluster[cl.normalized]).join(',')} />
							<button
								type="submit"
								disabled={!survivorByCluster[cl.normalized]}
								style="display:inline-flex; align-items:center; height:32px; padding:0 12px; background:var(--primary); color:var(--primary-foreground); border:none; border-radius:8px; font-family:inherit; font-size:13px; font-weight:500; cursor:pointer; margin-top:8px; opacity:{!survivorByCluster[cl.normalized] ? 0.5 : 1};"
							>
								Merge into selected
							</button>
						</form>
					</div>
				{/each}
			</div>
		</Sheet.Content>
	</Sheet.Portal>
</Sheet.Root>

<style>
	.inactive { opacity: 0.55; }
	.badge-warn { display: inline-flex; align-items: center; font-size: 11.5px; background: var(--amber-soft); color: var(--amber); padding: 2px 9px; border-radius: 999px; white-space: nowrap; }
	.td-actions { text-align: right; white-space: nowrap; }
	.link-danger { background: none; border: none; color: var(--red); cursor: pointer; font-size: 13px; font-family: inherit; padding: 0 6px; }
	.link-danger:hover { text-decoration: underline; }
	.cluster { border: 1px solid var(--border); border-radius: var(--radius); padding: 14px; margin-bottom: 12px; }
	.cluster-name { font-weight: 600; margin-bottom: 8px; font-size: 13.5px; }
	.cluster-row { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 13.5px; cursor: pointer; }
</style>
