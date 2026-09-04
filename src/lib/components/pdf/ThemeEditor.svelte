<script lang="ts">
	type Props = {
		color: string;
		onColorChange: (c: string) => void;
	};

	let { color, onColorChange }: Props = $props();

	const PRESETS = ['#1a56db', '#0e7490', '#166534', '#9f1239', '#7c3aed', '#b45309', '#1f2937'];
</script>

<div class="theme-editor">
	<div class="theme-row">
		<p class="theme-label">Accent color</p>
		<div class="theme-presets">
			{#each PRESETS as preset (preset)}
				<button
					class="theme-preset"
					class:active={color === preset}
					style="background:{preset}"
					onclick={() => onColorChange(preset)}
					title={preset}
				></button>
			{/each}
			<label class="theme-custom" title="Custom color">
				<input type="color" value={color} oninput={(e) => onColorChange((e.target as HTMLInputElement).value)} />
				<span class="theme-custom-swatch" style="background:{color}"></span>
			</label>
		</div>
	</div>
</div>

<style>
	.theme-editor { display: flex; flex-direction: column; gap: 12px; padding: 12px 0; }
	.theme-row { display: flex; flex-direction: column; gap: 6px; }
	.theme-label { font-size: 11px; font-weight: 600; color: var(--muted-foreground); text-transform: uppercase; letter-spacing: 0.04em; }
	.theme-presets { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
	.theme-preset {
		width: 22px; height: 22px; border-radius: 50%; border: 2px solid transparent;
		cursor: pointer; padding: 0; flex-shrink: 0;
	}
	.theme-preset.active { border-color: var(--foreground); }
	.theme-custom { position: relative; width: 22px; height: 22px; cursor: pointer; }
	.theme-custom input[type=color] { position: absolute; opacity: 0; width: 0; height: 0; }
	.theme-custom-swatch { display: block; width: 22px; height: 22px; border-radius: 50%; border: 2px dashed var(--border); }
</style>
