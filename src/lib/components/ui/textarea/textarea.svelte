<script lang="ts">
	import type { HTMLTextareaAttributes } from "svelte/elements";
	import { cn, focusRingClass, type WithElementRef } from "$lib/utils.js";

	type Props = WithElementRef<HTMLTextareaAttributes>;

	let {
		ref = $bindable(null),
		value = $bindable(),
		class: className,
		"data-slot": dataSlot = "textarea",
		...restProps
	}: Props = $props();
</script>

<textarea
	bind:this={ref}
	data-slot={dataSlot}
	class={cn(
		"border-input aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 min-h-[72px] w-full rounded-md border bg-card px-3 py-2 text-[13.5px] transition-[color,box-shadow] placeholder:text-muted-foreground aria-invalid:ring-3 outline-none resize-y disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
		focusRingClass,
		className
	)}
	bind:value
	{...restProps}
></textarea>
