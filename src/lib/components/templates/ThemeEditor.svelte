<script lang="ts">
	import { TemplateFontLabels } from '$lib/enums.js';

	type Props = {
		color: string;
		font: number;
		onColorChange: (c: string) => void;
		onFontChange: (f: number) => void;
	};

	let { color, font, onColorChange, onFontChange }: Props = $props();

	const FONT_OPTIONS = Object.entries(TemplateFontLabels).map(([code, label]) => ({
		code: parseInt(code),
		label
	}));

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
	<div class="theme-row">
		<p class="theme-label">Font family</p>
		<div class="theme-fonts">
			{#each FONT_OPTIONS as opt (opt.code)}
				<button
					class="theme-font-btn"
					class:active={font === opt.code}
					onclick={() => onFontChange(opt.code)}
				>
					{opt.label}
				</button>
			{/each}
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
	.theme-fonts { display: flex; flex-wrap: wrap; gap: 4px; }
	.theme-font-btn {
		padding: 4px 10px; border-radius: 4px; border: 1px solid var(--border);
		background: none; font-size: 12px; cursor: pointer; color: var(--foreground);
	}
	.theme-font-btn.active { background: var(--primary); color: #fff; border-color: var(--primary); }
</style>
