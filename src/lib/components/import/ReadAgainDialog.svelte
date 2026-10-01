<script lang="ts">
	import { untrack } from 'svelte';
	import { Dialog } from 'bits-ui';
	import { RotateCcw } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { ImportReadAs } from '$lib/import-reading.js';
	import { hasProfileChoice } from './review-card.js';

	/**
	 * "Read again" (006 FR-023, US9 AS6): reads a document once more from the
	 * file already uploaded, the way the user now chooses, without uploading it
	 * again. What the last reading proposed is thrown away and replaced.
	 *
	 * The dialog only asks and sends. The server decides whether the document
	 * may be read again and says why not; the job then goes back into the
	 * queue, and every open screen follows it through the live updates, so
	 * nothing here changes the list itself.
	 */
	let {
		open = $bindable(false),
		jobId,
		filename,
		choices,
		current,
		replaces,
		ondone
	}: {
		open?: boolean;
		jobId: string;
		filename: string;
		/** The "Read as" choices an upload offers, in its words (FR-001). */
		choices: { value: string; label: string }[];
		/** How the document was asked to be read last time, as a "Read as" value. */
		current: string;
		/** What reading it again throws away, in a sentence. */
		replaces: string;
		/** Called once the server has queued the new reading. */
		ondone?: () => void;
	} = $props();

	let choice = $state<string>(ImportReadAs.Auto);
	let sending = $state(false);
	let error = $state<string | null>(null);

	// Each time it opens, it starts from the reading the document had, so the
	// user sees what was used. A profile turned off since is not offered, and
	// Auto-detect stands in for it.
	$effect(() => {
		if (!open) return;
		untrack(() => {
			choice = choices.some((c) => c.value === current) ? current : ImportReadAs.Auto;
			error = null;
		});
	});

	const profilesEnabled = $derived(hasProfileChoice(choices));

	async function readAgain() {
		if (sending) return;
		sending = true;
		error = null;
		try {
			const res = await fetch(`/api/import/${jobId}/reread`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ readAs: choice }),
				credentials: 'include'
			});
			if (!res.ok) {
				// A rule refused it and nothing changed: say why, here.
				if (res.status === 403) {
					error = 'You do not have permission to read documents again.';
				} else {
					const body = await res.json().catch(() => ({}));
					error = body.error ?? 'It could not be read again. Try again.';
				}
				return;
			}
			open = false;
			ondone?.();
		} catch {
			error = 'That did not reach the server. Check the connection and try again.';
		} finally {
			sending = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Portal>
		<Dialog.Overlay class="fixed inset-0 z-[60] bg-black/35" />
		<Dialog.Content
			class="bg-popover text-popover-foreground fixed top-1/2 left-1/2 z-[60] flex max-h-[90dvh] w-[min(90vw,440px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg p-5 shadow-lg [border:1px_solid_var(--border)]"
		>
			<Dialog.Title class="text-[15px] font-semibold">Read again</Dialog.Title>
			<Dialog.Description class="text-muted-foreground mt-2 text-[13px] leading-relaxed">
				Reads <b class="ra-file">{filename}</b> again from the file already uploaded. {replaces}
			</Dialog.Description>

			<div class="ra-choices" role="radiogroup" aria-label="Read as">
				{#each choices as option (option.value)}
					<label class="ra-choice" class:on={choice === option.value}>
						<input
							type="radio"
							name="read-again-{jobId}"
							value={option.value}
							checked={choice === option.value}
							onchange={() => (choice = option.value)}
						/>
						<span class="ra-choice-main">
							<span class="ra-choice-label">{option.label}</span>
							{#if option.value === ImportReadAs.Auto && profilesEnabled}
								<span class="ra-choice-hint">Uses a saved profile that fits, or else the standard reading.</span>
							{/if}
						</span>
					</label>
				{/each}
			</div>

			{#if error}
				<p class="ra-error" role="alert">{error}</p>
			{/if}

			<div class="mt-5 flex justify-end gap-2">
				<Dialog.Close>
					{#snippet child({ props })}
						<Button {...props} variant="outline" size="sm">Cancel</Button>
					{/snippet}
				</Dialog.Close>
				<Button size="sm" disabled={sending} onclick={readAgain}>
					<RotateCcw size={14} />
					{sending ? 'Sending…' : 'Read again'}
				</Button>
			</div>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

<style>
	.ra-file {
		font-weight: 500;
		color: var(--foreground);
		overflow-wrap: anywhere;
	}
	/* The choices scroll on their own when there are many profiles, so the
	   buttons stay in view. */
	.ra-choices {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin-top: 14px;
		overflow-y: auto;
		min-height: 0;
	}
	.ra-choice {
		display: flex;
		align-items: flex-start;
		gap: 9px;
		padding: 8px 10px;
		border: 1px solid var(--border);
		border-radius: 8px;
		cursor: pointer;
		font-size: 13px;
	}
	.ra-choice.on {
		border-color: var(--primary);
		background: var(--accent);
	}
	.ra-choice input {
		margin-top: 3px;
		accent-color: var(--primary);
		flex-shrink: 0;
	}
	.ra-choice-main {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.ra-choice-label {
		overflow-wrap: anywhere;
	}
	.ra-choice-hint {
		font-size: 11.5px;
		color: var(--muted-foreground);
	}
	.ra-error {
		margin: 12px 0 0;
		font-size: 12.5px;
		color: var(--red);
	}
</style>
