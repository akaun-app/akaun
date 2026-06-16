<script lang="ts">
	import { enhance } from '$app/forms';
	import { onMount, onDestroy } from 'svelte';
	import { Plus, Search, X, Users, Merge } from '@lucide/svelte';
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import { EntityType, Role, EntityTypeLabels, RoleLabels } from '$lib/enums.js';
	import type { PageData, ActionData } from './$types.js';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	type Contact = (typeof data.contacts)[0];

	let contacts = $state<Contact[]>(data.contacts);
	$effect(() => { contacts = data.contacts; });

	let searchRaw = $state('');
	let search = $state('');
	let roleFilter = $state<number | 0>(0);
	let entityFilter = $state<number | 0>(0);
	let showInactive = $state(false);

	$effect(() => {
		const v = searchRaw;
		const t = setTimeout(() => (search = v), 300);
		return () => clearTimeout(t);
	});

	const ROLE_OPTIONS = [Role.Customer, Role.Supplier, Role.Employee];

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
	let es: EventSource | null = null;
	onMount(() => {
		es = new EventSource('/api/contacts/stream');
		es.onmessage = (e) => {
			const msg = JSON.parse(e.data);
			if (msg.type === 'contact-update') merge([msg.item]);
			else if (msg.type === 'contact-delete') contacts = contacts.filter((c) => c.id !== msg.id);
		};
	});
	onDestroy(() => es?.close());

	function merge(incoming: Contact[]) {
		const byId = new Map(incoming.map((c) => [c.id, c]));
		const existing = new Set(contacts.map((c) => c.id));
		contacts = contacts.map((c) => byId.get(c.id) ?? c);
		const brandNew = incoming.filter((c) => !existing.has(c.id));
		if (brandNew.length) contacts = [...brandNew, ...contacts];
	}
</script>

<div class="page">
	<header class="page-head">
		<div>
			<h1><Users size={20} /> Contacts</h1>
			<p class="sub">{filtered.length} {filtered.length === 1 ? 'contact' : 'contacts'}</p>
		</div>
		<div class="head-actions">
			{#if data.perms.change && data.perms.delete}
				<button class="btn ghost" onclick={loadDuplicates}><Merge size={15} /> Find duplicates</button>
			{/if}
			{#if data.perms.add}
				<button class="btn primary" onclick={openCreate}><Plus size={15} /> New contact</button>
			{/if}
		</div>
	</header>

	<div class="filters">
		<div class="searchbox">
			<Search size={15} />
			<input placeholder="Search name, email, reg no…" bind:value={searchRaw} />
		</div>
		<select bind:value={roleFilter}>
			<option value={0}>All roles</option>
			{#each ROLE_OPTIONS as r}<option value={r}>{RoleLabels[r]}</option>{/each}
		</select>
		<select bind:value={entityFilter}>
			<option value={0}>All types</option>
			<option value={EntityType.Individual}>individual</option>
			<option value={EntityType.Business}>business</option>
		</select>
		<label class="chk"><input type="checkbox" bind:checked={showInactive} /> Show inactive</label>
	</div>

	<table class="contacts-table">
		<thead>
			<tr><th>Name</th><th>Type</th><th>Roles</th><th>Email</th><th></th></tr>
		</thead>
		<tbody>
			{#each filtered as c (c.id)}
				<tr class:inactive={!c.isActive}>
					<td>
						<span class="name">{c.legalName}</span>
						{#if !c.isActive}<span class="badge muted">inactive</span>{/if}
					</td>
					<td>{EntityTypeLabels[c.entityType] ?? '—'}</td>
					<td>
						{#if c.roles.length === 0}
							<span class="badge warn">no roles</span>
						{:else}
							{#each c.roleLabels as rl}<span class="badge">{rl}</span>{/each}
						{/if}
					</td>
					<td class="muted-cell">{c.email ?? '—'}</td>
					<td class="row-actions">
						{#if data.perms.change}
							<button class="link" onclick={() => openEdit(c)}>Edit</button>
						{/if}
						{#if data.perms.delete && c.isActive}
							<form method="POST" action="?/deactivate" use:enhance style="display:inline">
								<input type="hidden" name="id" value={c.id} />
								<button class="link danger" type="submit">Deactivate</button>
							</form>
						{/if}
					</td>
				</tr>
			{:else}
				<tr><td colspan="5" class="empty">No contacts found.</td></tr>
			{/each}
		</tbody>
	</table>
</div>

<!-- Create / edit sheet -->
<Sheet.Root open={showForm} onOpenChange={(o) => (showForm = o)}>
	<Sheet.Portal>
		<Sheet.Overlay />
		<Sheet.Content side="right" style="width:460px; max-width:95vw; overflow-y:auto;">
			<div class="sheet-body">
				<div class="sheet-head">
					<h2>{editing ? 'Edit contact' : 'New contact'}</h2>
					<Sheet.Close class="sheet-close"><X size={16} /></Sheet.Close>
				</div>
				{#if form?.error}<p class="err">{form.error}</p>{/if}
				<form method="POST" action={editing ? '?/update' : '?/create'} use:enhance>
					{#if editing}<input type="hidden" name="id" value={editing.id} />{/if}

					<div class="field">
						<span class="lbl">Entity type *</span>
						<div class="seg">
							<label class:on={fEntityType === EntityType.Individual}>
								<input type="radio" name="entityType" value={EntityType.Individual} bind:group={fEntityType} /> Individual
							</label>
							<label class:on={fEntityType === EntityType.Business}>
								<input type="radio" name="entityType" value={EntityType.Business} bind:group={fEntityType} /> Business
							</label>
						</div>
					</div>

					<div class="field">
						<label class="lbl" for="legalName">Legal name *</label>
						<input id="legalName" name="legalName" required value={editing?.legalName ?? ''} />
					</div>

					<div class="field">
						<span class="lbl">Roles</span>
						<div class="roles">
							{#each ROLE_OPTIONS as r}
								<label class:on={fRoles.includes(r)}>
									<input type="checkbox" name="roles" value={r} checked={fRoles.includes(r)} onchange={() => toggleRole(r)} />
									{RoleLabels[r]}
								</label>
							{/each}
						</div>
					</div>

					<div class="field">
						<label class="lbl" for="registrationNo">Registration no.</label>
						<input id="registrationNo" name="registrationNo" value={editing?.registrationNo ?? ''} />
					</div>
					<div class="field">
						<label class="lbl" for="email">Email</label>
						<input id="email" name="email" type="email" value={editing?.email ?? ''} />
					</div>
					<div class="field">
						<label class="lbl" for="phone">Phone</label>
						<input id="phone" name="phone" value={editing?.phone ?? ''} />
					</div>
					<div class="field">
						<label class="lbl" for="address">Address</label>
						<textarea id="address" name="address" rows="2">{editing?.address ?? ''}</textarea>
					</div>
					<div class="field">
						<label class="lbl" for="remark">Remark</label>
						<textarea id="remark" name="remark" rows="2">{editing?.remark ?? ''}</textarea>
					</div>

					<button class="btn primary full" type="submit" disabled={!fEntityType}>
						{editing ? 'Save changes' : 'Create contact'}
					</button>
				</form>
			</div>
		</Sheet.Content>
	</Sheet.Portal>
</Sheet.Root>

<!-- Find duplicates / merge sheet -->
<Sheet.Root open={showMerge} onOpenChange={(o) => (showMerge = o)}>
	<Sheet.Portal>
		<Sheet.Overlay />
		<Sheet.Content side="right" style="width:500px; max-width:95vw; overflow-y:auto;">
			<div class="sheet-body">
				<div class="sheet-head">
					<h2>Duplicate contacts</h2>
					<Sheet.Close class="sheet-close"><X size={16} /></Sheet.Close>
				</div>
				{#if clusters.length === 0}
					<p class="muted">No duplicate clusters found.</p>
				{/if}
				{#each clusters as cl}
					<div class="cluster">
						<div class="cluster-name">“{cl.normalized}”</div>
						<form method="POST" action="?/merge" use:enhance>
							{#each cl.contacts as c}
								<label class="cluster-row">
									<input type="radio" name="survivor-{cl.normalized}" value={c.id}
										onchange={() => (survivorByCluster[cl.normalized] = c.id)} />
									<span>{c.legalName} <span class="muted">#{c.id}</span></span>
								</label>
							{/each}
							<input type="hidden" name="survivorId" value={survivorByCluster[cl.normalized] ?? ''} />
							<input type="hidden" name="loserIds"
								value={cl.contacts.map((c) => c.id).filter((id) => id !== survivorByCluster[cl.normalized]).join(',')} />
							<button class="btn primary" type="submit" disabled={!survivorByCluster[cl.normalized]}>
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
	.page { padding: 24px; max-width: 1100px; margin: 0 auto; }
	.page-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 18px; }
	.page-head h1 { display: flex; align-items: center; gap: 8px; font-size: 20px; margin: 0; }
	.sub { color: var(--muted-foreground); font-size: 13px; margin: 2px 0 0; }
	.head-actions { display: flex; gap: 8px; }
	.btn { display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 14px; border-radius: 8px;
		font-size: 13px; font-family: inherit; cursor: pointer; border: 1px solid var(--border); background: var(--card); color: var(--foreground); }
	.btn.primary { background: var(--primary); color: var(--primary-foreground); border: none; }
	.btn.full { width: 100%; justify-content: center; margin-top: 8px; }
	.btn:disabled { opacity: 0.5; cursor: default; }
	.filters { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-bottom: 14px; }
	.searchbox { display: flex; align-items: center; gap: 6px; border: 1px solid var(--input); border-radius: 8px; padding: 0 10px; height: 34px; background: var(--card); flex: 1; min-width: 200px; }
	.searchbox input { border: none; outline: none; background: none; font-family: inherit; font-size: 13px; width: 100%; color: var(--foreground); }
	.filters select { height: 34px; border: 1px solid var(--input); border-radius: 8px; background: var(--card); color: var(--foreground); font-family: inherit; font-size: 13px; padding: 0 8px; }
	.chk { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--muted-foreground); }
	.contacts-table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
	.contacts-table th { text-align: left; padding: 8px 10px; color: var(--muted-foreground); font-weight: 500; border-bottom: 1px solid var(--border); font-size: 12px; }
	.contacts-table td { padding: 10px; border-bottom: 1px solid var(--border); vertical-align: middle; }
	tr.inactive { opacity: 0.55; }
	.name { font-weight: 500; }
	.muted-cell, .muted { color: var(--muted-foreground); }
	.badge { display: inline-block; font-size: 11px; background: var(--secondary); color: var(--secondary-foreground); padding: 2px 8px; border-radius: 999px; margin-right: 4px; }
	.badge.warn { background: #fef3c7; color: #92400e; }
	.badge.muted { background: var(--muted); color: var(--muted-foreground); }
	.row-actions { text-align: right; white-space: nowrap; }
	.link { background: none; border: none; color: var(--primary); cursor: pointer; font-size: 13px; font-family: inherit; padding: 0 6px; }
	.link.danger { color: #dc2626; }
	.empty { text-align: center; color: var(--muted-foreground); padding: 28px; }
	.sheet-body { padding: 22px; }
	.sheet-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
	.sheet-head h2 { font-size: 16px; margin: 0; }
	.field { margin-bottom: 14px; display: flex; flex-direction: column; gap: 6px; }
	.lbl { font-size: 12.5px; color: var(--muted-foreground); }
	.field input, .field textarea { border: 1px solid var(--input); border-radius: 8px; padding: 8px 10px; font-family: inherit; font-size: 13.5px; background: var(--card); color: var(--foreground); outline: none; }
	.seg, .roles { display: flex; gap: 8px; flex-wrap: wrap; }
	.seg label, .roles label { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--border); border-radius: 8px; padding: 6px 12px; font-size: 13px; cursor: pointer; }
	.seg label.on, .roles label.on { border-color: var(--primary); background: color-mix(in srgb, var(--primary) 10%, transparent); }
	.err { color: #dc2626; font-size: 13px; margin-bottom: 10px; }
	.cluster { border: 1px solid var(--border); border-radius: 10px; padding: 14px; margin-bottom: 12px; }
	.cluster-name { font-weight: 600; margin-bottom: 8px; }
	.cluster-row { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 13.5px; }
</style>
