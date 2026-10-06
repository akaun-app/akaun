<script lang="ts">
	import { resolve } from '$app/paths';
	import { Paperclip, Plus, X } from '@lucide/svelte';
	import ViewportFileDrop from './ViewportFileDrop.svelte';

	export type Attachment = { id: number; filename: string; displayName: string; addedDate: string };

	let {
		apiBase,
		attachments = $bindable(),
		disabled = false
	}: {
		/** Base URL of the owning record, e.g. `/api/records/123`. */
		apiBase: string;
		attachments: Attachment[];
		disabled?: boolean;
	} = $props();

	let fileInput = $state<HTMLInputElement | null>(null);
	let error = $state('');

	async function upload(files: FileList | File[]) {
		if (disabled) return;
		error = '';
		const uploadBase = apiBase;
		for (const file of Array.from(files)) {
			try {
				const fd = new FormData();
				fd.append('file', file);
				const res = await fetch(`${uploadBase}/attachments`, { method: 'POST', body: fd });
				if (apiBase !== uploadBase) return;
				if (res.ok) {
					const att: Attachment = await res.json();
					if (apiBase !== uploadBase) return;
					attachments = [...attachments, att];
				} else {
					const body = await res.json().catch(() => null);
					error = `${file.name}: ${body?.error ?? 'Failed to upload attachment'}`;
				}
			} catch {
				if (apiBase !== uploadBase) return;
				error = `${file.name}: the upload did not reach the server. Try again.`;
			}
		}
	}

	async function remove(attachmentId: number) {
		if (disabled) return;
		error = '';
		const res = await fetch(`${apiBase}/attachments/${attachmentId}`, { method: 'DELETE' });
		if (res.ok) {
			attachments = attachments.filter((a) => a.id !== attachmentId);
		} else {
			const body = await res.json().catch(() => null);
			error = body?.error ?? 'Failed to delete attachment';
		}
	}

	function onFileInput(e: Event) {
		const input = e.target as HTMLInputElement;
		if (input.files) upload(input.files);
		input.value = '';
	}
</script>

<ViewportFileDrop destination="attach to this record" {disabled} onfiles={upload} />

<div class="attach-section-header">
	<div class="detail-section-label" style="margin:0;">Attachments</div>
	<button type="button" class="attach-add-btn" {disabled} onclick={() => fileInput?.click()}>
		<Plus size={11} /> Add
	</button>
</div>
{#if error}
	<div role="alert" style="background:var(--red-soft); color:var(--red); border-radius:8px; padding:8px 12px; font-size:12.5px; margin-bottom:8px;">{error}</div>
{/if}
<div
	class="attach-drop-area"
	role="group"
	aria-label="Attachments"
>
	{#if attachments.length > 0}
		<div class="attach-list">
			{#each attachments as att (att.id)}
				<div class="attach-item related-link">
					<a
						href={resolve('/api/files/[...path]', { path: att.filename })}
						target="_blank"
						rel="noopener"
						class="attach-link-area"
						aria-label="Open {att.displayName}"
					>
						<div class="attach-thumb"><Paperclip size={16} /></div>
						<div class="attach-meta">
							<div class="attach-name">{att.displayName}</div>
							<div class="attach-sub">{att.addedDate}</div>
						</div>
					</a>
					<button type="button" class="attach-del" {disabled} onclick={() => remove(att.id)}>
						<X size={14} />
					</button>
				</div>
			{/each}
		</div>
	{:else if !disabled}
		<div
			class="attach-empty attach-empty-drop"
			role="button"
			tabindex="0"
			onclick={() => fileInput?.click()}
			onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput?.click(); } }}
		>
			<Paperclip size={14} /> Drop files here or click to add
		</div>
	{/if}
</div>
<input bind:this={fileInput} type="file" accept=".pdf,.jpg,.jpeg,.png" multiple style="display:none" onchange={onFileInput} />
