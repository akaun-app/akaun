<script lang="ts">
	import * as Popover from '$lib/components/ui/popover/index.js';
	import Calendar from '$lib/components/ui/calendar/calendar.svelte';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import {
		DateFormatter,
		type DateValue,
		getLocalTimeZone,
		parseDate,
		today as getToday
	} from '@internationalized/date';

	let {
		name = undefined,
		value = $bindable<string | undefined>(undefined),
		defaultToday = false,
		onchange = undefined,
		placeholder = 'Pick a date'
	}: {
		name?: string;
		value?: string;
		defaultToday?: boolean;
		onchange?: (v: string) => void;
		placeholder?: string;
	} = $props();

	const df = new DateFormatter('en-GB', { dateStyle: 'medium' });

	// Initialise internal DateValue from prop (or today if defaultToday)
	function toDateValue(iso: string | undefined): DateValue | undefined {
		if (iso) return parseDate(iso);
		if (defaultToday) return getToday(getLocalTimeZone());
		return undefined;
	}

	let dateValue = $state<DateValue | undefined>(toDateValue(value));
	let open = $state(false);

	// Sync inward: when parent clears value (e.g. filter reset), clear internal state
	$effect(() => {
		const v = value;
		if (!v) {
			dateValue = undefined;
		} else if (!dateValue || dateValue.toString() !== v) {
			dateValue = parseDate(v);
		}
	});

	const displayLabel = $derived(
		dateValue ? df.format(dateValue.toDate(getLocalTimeZone())) : placeholder
	);

	function handleSelect(v: DateValue | undefined) {
		if (!v) return;
		dateValue = v;
		value = v.toString();
		onchange?.(value);
		open = false;
	}
</script>

<Popover.Root bind:open>
	<Popover.Trigger
		class="border-input focus-visible:border-ring focus-visible:ring-[var(--primary-soft)] data-[state=open]:border-ring data-[state=open]:ring-[var(--primary-soft)] data-[state=open]:ring-3 flex h-9 w-full items-center gap-2 rounded-md border bg-card px-3 text-[13.5px] outline-none transition-[color,box-shadow] focus-visible:ring-3"
		style="color:{dateValue ? 'var(--foreground)' : 'var(--muted-foreground)'}; text-align:left;"
	>
		<CalendarIcon size={14} style="flex-shrink:0; opacity:0.5;" />
		{displayLabel}
	</Popover.Trigger>
	<Popover.Content align="start" class="w-auto p-0">
		<Calendar
			type="single"
			value={dateValue}
			onValueChange={handleSelect}
		/>
	</Popover.Content>
</Popover.Root>
{#if name}
	<input type="hidden" {name} value={value ?? ''} />
{/if}
