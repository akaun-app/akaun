<script lang="ts">
	import { onMount } from 'svelte';
	import { Upload } from '@lucide/svelte';

	let {
		destination,
		disabled = false,
		onfiles,
	}: {
		destination: string;
		disabled?: boolean;
		onfiles: (files: File[]) => void | Promise<void>;
	} = $props();

	let dragging = $state(false);
	let marker = $state<HTMLSpanElement | null>(null);

	$effect(() => {
		if (disabled) dragging = false;
	});

	onMount(() => {
		let depth = 0;
		// Ignore mounted destinations hidden by a closed sheet or inactive tab.
		const visible = () =>
			marker !== null &&
			marker.getClientRects().length > 0 &&
			getComputedStyle(marker).visibility !== 'hidden';
		const isFileDrag = (event: DragEvent) =>
			Array.from(event.dataTransfer?.types ?? []).includes('Files');
		const reset = () => {
			depth = 0;
			dragging = false;
		};
		const enter = (event: DragEvent) => {
			if (!visible() || !isFileDrag(event)) return;
			event.preventDefault();
			depth += 1;
			dragging = !disabled;
		};
		const over = (event: DragEvent) => {
			if (!visible() || !isFileDrag(event)) return;
			event.preventDefault();
			if (event.dataTransfer)
				event.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
			dragging = !disabled;
		};
		const leave = (event: DragEvent) => {
			if (!isFileDrag(event)) return;
			depth = Math.max(0, depth - 1);
			if (depth === 0) reset();
		};
		const drop = (event: DragEvent) => {
			reset();
			if (!visible() || !isFileDrag(event)) return;
			// Capture before the local drop target to deliver each file only once.
			event.preventDefault();
			event.stopImmediatePropagation();
			const files = Array.from(event.dataTransfer?.files ?? []);
			if (!disabled && files.length > 0) void onfiles(files);
		};
		const keydown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') reset();
		};
		window.addEventListener('dragenter', enter, true);
		window.addEventListener('dragover', over, true);
		window.addEventListener('dragleave', leave, true);
		window.addEventListener('drop', drop, true);
		window.addEventListener('dragend', reset);
		window.addEventListener('blur', reset);
		window.addEventListener('keydown', keydown);
		return () => {
			window.removeEventListener('dragenter', enter, true);
			window.removeEventListener('dragover', over, true);
			window.removeEventListener('dragleave', leave, true);
			window.removeEventListener('drop', drop, true);
			window.removeEventListener('dragend', reset);
			window.removeEventListener('blur', reset);
			window.removeEventListener('keydown', keydown);
		};
	});
</script>

<span bind:this={marker} class="drop-marker" aria-hidden="true"></span>
{#if dragging}
	<div class="viewport-drop" role="status">
		<div class="drop-message">
			<Upload size={32} />
			<strong>Drop files to {destination}</strong>
		</div>
	</div>
{/if}

<style>
	.drop-marker {
		position: absolute;
		width: 1px;
		height: 1px;
		pointer-events: none;
	}
	.viewport-drop {
		position: fixed;
		inset: 12px;
		z-index: 10000;
		pointer-events: none;
		display: grid;
		place-items: center;
		border: 3px dashed var(--primary);
		border-radius: 16px;
		background: color-mix(in srgb, var(--background) 90%, transparent);
		color: var(--foreground);
		padding: 24px;
	}
	.drop-message {
		display: grid;
		justify-items: center;
		gap: 16px;
		text-align: center;
		overflow-wrap: anywhere;
	}
</style>
