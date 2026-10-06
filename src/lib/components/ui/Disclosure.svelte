<script lang="ts">
	import type { Snippet } from 'svelte';
	import { ChevronRight } from '@lucide/svelte';
	import * as Collapsible from '$lib/components/ui/collapsible/index.js';
	import { cn } from '$lib/utils.js';

	/**
	 * The one expander of the app: a quiet line that opens to show what is
	 * used less often, such as "More options" or the lines a reading left out.
	 * Use it in place of a raw `<details>`, so every expander looks and works
	 * the same, with the theme's focus ring and the keyboard.
	 *
	 * `forceOpen` keeps it open while what it holds needs the user, such as a
	 * field with a problem after a save was tried; the user cannot close it
	 * then. `open` is what the user chose, kept for when nothing forces it.
	 */
	let {
		label,
		open = $bindable(false),
		forceOpen = false,
		class: className,
		children
	}: {
		label: string;
		open?: boolean;
		forceOpen?: boolean;
		class?: string;
		children: Snippet;
	} = $props();

	const shown = $derived(open || forceOpen);
</script>

<Collapsible.Root
	open={shown}
	onOpenChange={(next) => {
		if (!forceOpen) open = next;
	}}
	class={cn('disclosure', className)}
>
	<Collapsible.Trigger
		class="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 inline-flex h-6 items-center gap-1.5 rounded-md pr-1 text-[13px] leading-none font-medium transition-colors outline-none focus-visible:ring-[3px]"
	>
		<ChevronRight
			size={14}
			class={cn('shrink-0 transition-transform duration-150 motion-reduce:transition-none', shown && 'rotate-90')}
			aria-hidden="true"
		/>
		<!-- Its own box with no leading, set 1px down: the font's glyphs sit high
		     in their box, so a plain centre puts the text above the chevron's. -->
		<span class="translate-y-px leading-none">{label}</span>
	</Collapsible.Trigger>
	<Collapsible.Content class="pt-3">
		{@render children()}
	</Collapsible.Content>
</Collapsible.Root>
