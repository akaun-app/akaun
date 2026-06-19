<script lang="ts">
	import { Combobox as ComboboxPrimitive } from "bits-ui";
	import { cn, focusRingClass, focusRingOpenClass, type WithoutChild } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: WithoutChild<ComboboxPrimitive.InputProps> = $props();
</script>

<ComboboxPrimitive.Input
	bind:ref
	data-slot="combobox-input"
	class={cn(
		"border-input data-placeholder:text-muted-foreground dark:bg-input/30 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 h-9 w-full rounded-md border bg-card px-3 text-[13.5px] transition-[color,box-shadow] outline-none aria-invalid:ring-3 disabled:cursor-not-allowed disabled:opacity-50",
		focusRingClass,
		focusRingOpenClass,
		className
	)}
	{...restProps}
/>
