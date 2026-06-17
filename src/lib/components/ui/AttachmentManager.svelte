<script lang="ts">
	import { Paperclip, Plus, X } from '@lucide/svelte';

	export type Attachment = { id: number; filename: string; displayName: string; addedDate: string };

	let {
		apiBase,
		attachments = $bindable()
	}: {
		/** Base URL of the owning record, e.g. `/api/expenses/123`. */
		apiBase: string;
		attachments: Attachment[];
	} = $props();

	let drag = $state(false);
	let fileInput = $state<HTMLInputElement | null>(null);

	async function upload(files: FileList) {
		for (const file of Array.from(files)) {
			const fd = new FormData();
			fd.append('file', file);
			const res = await fetch(`${apiBase}/attachments`, { method: 'POST', body: fd });
			if (res.ok) {
				const att: Attachment = await res.json();
				attachments = [...attachments, att];
			}
		}
	}

	async function remove(attachmentId: number) {
		await fetch(`${apiBase}/attachments/${attachmentId}`, { method: 'DELETE' });
		attachments = attachments.filter((a) => a.id !== attachmentId);
	}

	function onDrop(e: DragEvent) {
		e.preventDefault();
		drag = false;
		if (e.dataTransfer?.files) upload(e.dataTransfer.files);
	}
	function onFileInput(e: Event) {
		const input = e.target as HTMLInputElement;
		if (input.files) upload(input.files);
		input.value = '';
	}
</script>

<div class="attach-section-header">
	<div class="detail-section-label" style="margin:0;">Attachments</div>
	<button type="button" class="attach-add-btn" onclick={() => fileInput?.click()}>
		<Plus size={11} /> Add
	</button>
</div>
<div
	class="attach-drop-area"
	class:drag
	role="group"
	aria-label="Attachments"
	ondragover={(e) => { e.preventDefault(); drag = true; }}
	ondragleave={() => (drag = false)}
	ondrop={onDrop}
>
	{#if attachments.length > 0}
		<div class="attach-list">
			{#each attachments as att (att.id)}
				<div class="attach-item">
					<div class="attach-thumb"><Paperclip size={14} /></div>
					<div class="attach-meta">
						<a href="/api/files/{att.filename}" target="_blank" rel="noopener" class="attach-name attach-link">{att.displayName}</a>
						<div class="attach-sub">{att.addedDate}</div>
					</div>
					<button type="button" class="attach-del" onclick={() => remove(att.id)}>
						<X size={14} />
					</button>
				</div>
			{/each}
		</div>
	{:else}
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
