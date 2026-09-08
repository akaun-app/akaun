<script lang="ts">
	import * as Popover from '$lib/components/ui/popover/index.js';
	import { cn, focusRingClass, focusRingOpenClass } from '$lib/utils.js';

	type Preset = { hex: string; label: string };

	type Props = {
		value: string;
		onValueChange: (hex: string) => void;
		presets?: Preset[];
		disabled?: boolean;
	};

	let { value, onValueChange, presets = [], disabled = false }: Props = $props();

	// HSV, not the presets' own HSL-ish origin — this is what a saturation/value
	// square + hue slider naturally produce, so we convert to/from hex at the edges.
	let hue = $state(0);
	let sat = $state(0);
	let val = $state(0);
	// svelte-ignore state_referenced_locally
	let hexInput = $state(value);

	let slEl: HTMLDivElement | null = $state(null);

	function clamp01(n: number) {
		return Math.min(1, Math.max(0, n));
	}

	function hsvToHex(h: number, s: number, v: number): string {
		const c = v * s;
		const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
		const m = v - c;
		let r = 0,
			g = 0,
			b = 0;
		if (h < 60) [r, g, b] = [c, x, 0];
		else if (h < 120) [r, g, b] = [x, c, 0];
		else if (h < 180) [r, g, b] = [0, c, x];
		else if (h < 240) [r, g, b] = [0, x, c];
		else if (h < 300) [r, g, b] = [x, 0, c];
		else [r, g, b] = [c, 0, x];
		const toHex = (n: number) =>
			Math.round((n + m) * 255)
				.toString(16)
				.padStart(2, '0');
		return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
	}

	function hexToHsv(hex: string): { h: number; s: number; v: number } | null {
		const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
		if (!m) return null;
		const num = parseInt(m[1], 16);
		const r = ((num >> 16) & 255) / 255;
		const g = ((num >> 8) & 255) / 255;
		const b = (num & 255) / 255;
		const max = Math.max(r, g, b);
		const min = Math.min(r, g, b);
		const d = max - min;
		let h = 0;
		if (d !== 0) {
			if (max === r) h = (((g - b) / d) % 6) * 60;
			else if (max === g) h = ((b - r) / d + 2) * 60;
			else h = ((r - g) / d + 4) * 60;
			if (h < 0) h += 360;
		}
		const v = max;
		const s = max === 0 ? 0 : d / max;
		return { h, s, v };
	}

	function syncFromHex(hex: string) {
		const hsv = hexToHsv(hex);
		if (!hsv) return;
		hue = hsv.h;
		sat = hsv.s;
		val = hsv.v;
		hexInput = hex;
	}

	// Resync only when `value` changed from outside this component's own
	// commits (an external prop update), not on every render of our own edits.
	$effect(() => {
		const external = value;
		if (hexToHsv(external) && hsvToHex(hue, sat, val).toLowerCase() !== external.toLowerCase()) {
			syncFromHex(external);
		}
	});

	function commit() {
		const hex = hsvToHex(hue, sat, val);
		hexInput = hex;
		onValueChange(hex);
	}

	function updateFromSlPoint(e: PointerEvent) {
		if (!slEl) return;
		const rect = slEl.getBoundingClientRect();
		sat = clamp01((e.clientX - rect.left) / rect.width);
		val = clamp01(1 - (e.clientY - rect.top) / rect.height);
		commit();
	}

	function handleSlPointerDown(e: PointerEvent) {
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		updateFromSlPoint(e);
	}

	function handleSlPointerMove(e: PointerEvent) {
		if (e.buttons !== 1) return;
		updateFromSlPoint(e);
	}

	function handleSlKeyDown(e: KeyboardEvent) {
		const step = e.shiftKey ? 0.1 : 0.02;
		if (e.key === 'ArrowLeft') sat = clamp01(sat - step);
		else if (e.key === 'ArrowRight') sat = clamp01(sat + step);
		else if (e.key === 'ArrowUp') val = clamp01(val + step);
		else if (e.key === 'ArrowDown') val = clamp01(val - step);
		else return;
		e.preventDefault();
		commit();
	}

	function handleHueInput(e: Event) {
		hue = Number((e.target as HTMLInputElement).value);
		commit();
	}

	function handleHexInput(e: Event) {
		hexInput = (e.target as HTMLInputElement).value;
	}

	function commitHexInput() {
		const normalized = hexInput.startsWith('#') ? hexInput : `#${hexInput}`;
		const hsv = hexToHsv(normalized);
		if (hsv) {
			hue = hsv.h;
			sat = hsv.s;
			val = hsv.v;
			hexInput = normalized.toLowerCase();
			onValueChange(hexInput);
		} else {
			hexInput = value;
		}
	}

	function handleHexKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
	}

	function selectPreset(hex: string) {
		syncFromHex(hex);
		onValueChange(hex);
	}
</script>

<Popover.Root>
	<Popover.Trigger
		{disabled}
		class={cn(
			'border-input inline-flex h-9 items-center gap-2.5 rounded-md border bg-card px-3 text-[13px] outline-none transition-[color,box-shadow] disabled:cursor-not-allowed disabled:opacity-50',
			focusRingClass,
			focusRingOpenClass
		)}
	>
		<span
			class="h-5 w-5 shrink-0 rounded-full border border-black/10"
			style="background:{value};"
		></span>
		<span style="color:var(--foreground);">{value}</span>
	</Popover.Trigger>
	<Popover.Content align="start" class="w-[236px] gap-3 p-3">
		{#if presets.length > 0}
			<div class="flex flex-wrap gap-2">
				{#each presets as preset (preset.hex)}
					<button
						type="button"
						title={preset.label}
						aria-label={preset.label}
						onclick={() => selectPreset(preset.hex)}
						class="h-6 w-6 rounded-full border-2 transition-colors"
						style="background:{preset.hex}; border-color:{value.toLowerCase() ===
						preset.hex.toLowerCase()
							? 'var(--foreground)'
							: 'transparent'};"
					></button>
				{/each}
			</div>
		{/if}

		<div
			bind:this={slEl}
			role="slider"
			aria-label="Saturation and brightness"
			aria-valuetext={hexInput}
			aria-valuenow={Math.round(val * 100)}
			aria-valuemin="0"
			aria-valuemax="100"
			tabindex="0"
			class={cn(
				'relative h-28 w-full touch-none rounded-md outline-none select-none',
				focusRingClass
			)}
			style="background-color: hsl({hue} 100% 50%); background-image: linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent); cursor: crosshair;"
			onpointerdown={handleSlPointerDown}
			onpointermove={handleSlPointerMove}
			onkeydown={handleSlKeyDown}
		>
			<div
				class="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
				style="left:{sat * 100}%; top:{(1 - val) * 100}%; background:{value};"
			></div>
		</div>

		<input
			type="range"
			min="0"
			max="360"
			step="1"
			value={hue}
			oninput={handleHueInput}
			aria-label="Hue"
			class={cn('hue-range h-3 w-full appearance-none rounded-full outline-none', focusRingClass)}
			style="background: linear-gradient(to right, red, yellow, lime, cyan, blue, magenta, red);"
		/>

		<div class="flex items-center gap-2">
			<span class="text-[11px] font-medium" style="color:var(--muted-foreground);">Hex</span>
			<input
				type="text"
				value={hexInput}
				oninput={handleHexInput}
				onblur={commitHexInput}
				onkeydown={handleHexKeydown}
				maxlength="7"
				spellcheck="false"
				class={cn(
					'border-input h-8 flex-1 rounded-md border bg-card px-2 text-[13px] outline-none',
					focusRingClass
				)}
			/>
		</div>
	</Popover.Content>
</Popover.Root>

<style>
	.hue-range::-webkit-slider-thumb {
		appearance: none;
		-webkit-appearance: none;
		width: 14px;
		height: 14px;
		border-radius: 9999px;
		border: 2px solid white;
		box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.2);
		background: transparent;
		cursor: pointer;
	}
	.hue-range::-moz-range-thumb {
		width: 14px;
		height: 14px;
		border-radius: 9999px;
		border: 2px solid white;
		box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.2);
		background: transparent;
		cursor: pointer;
	}
	.hue-range::-moz-range-track {
		background: transparent;
	}
</style>
