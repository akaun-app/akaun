<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { fade } from 'svelte/transition';
	import { Camera, RotateCcw, RotateCw, Crop, Contrast, Check, X } from '@lucide/svelte';
	import { detectDocumentQuad } from '$lib/scanner/detection';
	import { extractPaper } from '$lib/scanner/transform';
	import { applyBWFilter, applyGrayscaleFilter } from '$lib/scanner/filters';
	import { loadImageRaw } from '$lib/scanner/image';
	import { getCv } from '$lib/scanner/cv';
	import type { Point, FilterType } from '$lib/scanner/types';
	import type { FinishedPage } from './page-types';

	interface Props {
		dataUrl: string;
		onretake: () => void;
		ondone: (page: FinishedPage) => void;
		onadjustchange?: (active: boolean) => void;
	}

	const { dataUrl, onretake, ondone, onadjustchange }: Props = $props();

	let resultCanvasEl = $state<HTMLCanvasElement>();
	let overlayCanvasEl = $state<HTMLCanvasElement>();
	let containerEl = $state<HTMLDivElement>();
	let magnifierCanvasEl = $state<HTMLCanvasElement>();

	let capturedImage: HTMLImageElement | null = null;
	let rawCanvas: HTMLCanvasElement | null = null;
	let imageWidth = $state(0);
	let imageHeight = $state(0);

	const MAGNIFIER_SIZE = 112;
	const ZOOM = 3;
	const MAGNIFIER_OFFSET = 80;
	let magnifierPos = $state({ x: 0, y: 0 });

	// The image is shown with object-contain, so it occupies a centered, letterboxed
	// sub-rectangle of the container. Handle placement and pointer mapping must use
	// this rect (not the full container) to stay aligned with the drawn outline.
	let dispRect = $state({ offsetX: 0, offsetY: 0, dispW: 0, dispH: 0 });

	// Untouched warped document, captured once per extract. Every filter renders
	// from this base, so switching filters is lossless and order-independent.
	let baseImageData: ImageData | null = null;

	let corners = $state<Point[]>([
		{ x: 0.05, y: 0.05 },
		{ x: 0.95, y: 0.05 },
		{ x: 0.95, y: 0.95 },
		{ x: 0.05, y: 0.95 }
	]);

	let dragIndex = $state(-1);

	const HANDLE_LABELS = ['TL', 'TR', 'BR', 'BL'];

	let showAdjust = $state(false);
	let filterType: FilterType = $state('bw');
	let showFilters = $state(false);
	let rotation: 0 | 90 | 180 | 270 = $state(0);
	let baking = $state(false);

	// True from mount until the first detect + warp finishes, driving the
	// scan-line animation. CSS keyframes run on the compositor, so the sweep
	// keeps animating even while the (synchronous) GrabCut detection blocks JS.
	let scanning = $state(true);

	// Live per-filter previews of the current warp, regenerated whenever the
	// document is (re-)extracted. Rendered in the always-visible filter strip.
	let filterThumbs = $state<Partial<Record<FilterType, string>>>({});

	// Snapshot of corners taken when entering Crop, so Cancel can restore them.
	let cornersBeforeAdjust: Point[] = [];

	const FILTERS: { label: string; value: FilterType }[] = [
		{ label: 'Colors', value: 'color' },
		{ label: 'Grayscale', value: 'grayscale' },
		{ label: 'B&W', value: 'bw' }
	];

	onMount(() => {
		const img = new Image();
		img.onload = () => {
			capturedImage = img;
			imageWidth = img.naturalWidth;
			imageHeight = img.naturalHeight;
			runAutoScan();
		};
		img.src = dataUrl;

		window.addEventListener('resize', handleResize);
		return () => window.removeEventListener('resize', handleResize);
	});

	function handleResize() {
		if (!showAdjust) return;
		computeDispRect();
		drawOverlay();
	}

	async function runAutoScan() {
		const cv = getCv();
		if (!cv || !capturedImage) return;

		scanning = true;
		await tick(); // paint the scan-line overlay before the blocking detection
		// Brief beat so the scan-line animation is visible even when detection is fast,
		// without adding needless latency.
		await new Promise((r) => setTimeout(r, 150));

		// Load raw pixel data bypassing browser ICC color management, matching
		// Python's cv2.imread() behavior, so the contour-detection and threshold
		// pipeline matches the reference. See loadImageRaw for the full rationale.
		const raw = await loadImageRaw(capturedImage);
		rawCanvas = raw;

		detectCorners();

		await tick();
		doExtract();
		drawOverlay();
		scanning = false;
	}

	// Run contour detection on the (already loaded) source and set corners.
	// Falls back to a 5% inset only when no document quad is found.
	function detectCorners() {
		const cv = getCv();
		const src = rawCanvas || capturedImage;
		if (!cv || !src) return;

		const w = rawCanvas ? rawCanvas.width : imageWidth;
		const h = rawCanvas ? rawCanvas.height : imageHeight;

		const quad = detectDocumentQuad(src);
		if (quad) {
			corners = [
				{ x: quad.topLeft.x / w, y: quad.topLeft.y / h },
				{ x: quad.topRight.x / w, y: quad.topRight.y / h },
				{ x: quad.bottomRight.x / w, y: quad.bottomRight.y / h },
				{ x: quad.bottomLeft.x / w, y: quad.bottomLeft.y / h }
			];
		} else {
			corners = [
				{ x: 0.05, y: 0.05 },
				{ x: 0.95, y: 0.05 },
				{ x: 0.95, y: 0.95 },
				{ x: 0.05, y: 0.95 }
			];
		}
		imageWidth = w;
		imageHeight = h;
	}

	function computeDispRect() {
		if (!containerEl || !imageWidth || !imageHeight) return;
		const cw = containerEl.clientWidth;
		const ch = containerEl.clientHeight;
		const scale = Math.min(cw / imageWidth, ch / imageHeight);
		const dispW = imageWidth * scale;
		const dispH = imageHeight * scale;
		dispRect = {
			offsetX: (cw - dispW) / 2,
			offsetY: (ch - dispH) / 2,
			dispW,
			dispH
		};
	}

	function getPixelPoints(): Point[] {
		return corners.map((c) => ({
			x: Math.round(c.x * imageWidth),
			y: Math.round(c.y * imageHeight)
		}));
	}

	function doExtract() {
		const src = rawCanvas || capturedImage;
		if (!src || !resultCanvasEl) return;

		const pts = getPixelPoints();
		const result = extractPaper(src, {
			topLeft: pts[0],
			topRight: pts[1],
			bottomRight: pts[2],
			bottomLeft: pts[3]
		});

		if (result) {
			const rctx = resultCanvasEl.getContext('2d')!;
			resultCanvasEl.width = result.width;
			resultCanvasEl.height = result.height;
			rctx.drawImage(result, 0, 0);
			baseImageData = rctx.getImageData(0, 0, resultCanvasEl.width, resultCanvasEl.height);
			renderFilter(filterType);
			generateThumbnails();
		}
	}

	// Render a small live preview of every filter from the cached base warp, so
	// the filter strip shows what each option actually does to this document.
	// Reuses the same filter fns as the main canvas — no separate pipeline.
	function generateThumbnails() {
		if (!baseImageData) return;
		const base = document.createElement('canvas');
		base.width = baseImageData.width;
		base.height = baseImageData.height;
		base.getContext('2d')!.putImageData(baseImageData, 0, 0);

		const TW = 108;
		const th = Math.max(1, Math.round((TW * baseImageData.height) / baseImageData.width));
		const out: Partial<Record<FilterType, string>> = {};
		for (const f of FILTERS) {
			const c = document.createElement('canvas');
			c.width = TW;
			c.height = th;
			c.getContext('2d')!.drawImage(base, 0, 0, TW, th);
			if (f.value === 'grayscale') applyGrayscaleFilter(c);
			else if (f.value === 'bw') applyBWFilter(c);
			out[f.value] = c.toDataURL('image/jpeg', 0.7);
		}
		filterThumbs = out;
	}

	// Restore the untouched warp, then apply the selected filter's pixel transform.
	function renderFilter(value: FilterType) {
		if (!resultCanvasEl || !baseImageData) return;
		const ctx = resultCanvasEl.getContext('2d')!;
		ctx.putImageData(baseImageData, 0, 0);
		if (value === 'grayscale') applyGrayscaleFilter(resultCanvasEl);
		else if (value === 'bw') applyBWFilter(resultCanvasEl);
		// 'color' → base already restored, nothing to apply
	}

	// Resolve --primary to a canvas-safe rgb() string (canvas color parsing is
	// reliable for rgb, less so for oklch). Cached; --primary is theme-stable.
	let cachedAccent = '';
	function accentColor(): string {
		if (cachedAccent) return cachedAccent;
		const probe = document.createElement('span');
		probe.style.color = 'var(--primary)';
		probe.style.display = 'none';
		document.body.appendChild(probe);
		cachedAccent = getComputedStyle(probe).color || '#d97742';
		probe.remove();
		return cachedAccent;
	}

	function drawOverlay() {
		if (!capturedImage || !overlayCanvasEl) return;

		const ctx = overlayCanvasEl.getContext('2d')!;
		overlayCanvasEl.width = imageWidth;
		overlayCanvasEl.height = imageHeight;
		ctx.drawImage(capturedImage, 0, 0);

		const pts = getPixelPoints();

		// Dim everything outside the selected quad so the document stands out
		// (even-odd fill: the full frame minus the quad interior).
		ctx.save();
		ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
		ctx.beginPath();
		ctx.rect(0, 0, imageWidth, imageHeight);
		ctx.moveTo(pts[0].x, pts[0].y);
		ctx.lineTo(pts[1].x, pts[1].y);
		ctx.lineTo(pts[2].x, pts[2].y);
		ctx.lineTo(pts[3].x, pts[3].y);
		ctx.closePath();
		ctx.fill('evenodd');
		ctx.restore();

		// Quad outline in the brand accent, echoing the review-screen brackets.
		// Line width scales with the source so it reads consistently on screen.
		ctx.save();
		ctx.strokeStyle = accentColor();
		ctx.lineWidth = Math.max(3, Math.round(Math.max(imageWidth, imageHeight) / 140));
		ctx.lineJoin = 'round';
		ctx.beginPath();
		ctx.moveTo(pts[0].x, pts[0].y);
		ctx.lineTo(pts[1].x, pts[1].y);
		ctx.lineTo(pts[2].x, pts[2].y);
		ctx.lineTo(pts[3].x, pts[3].y);
		ctx.closePath();
		ctx.stroke();
		ctx.restore();
	}

	function handlePointerDown(index: number, e: PointerEvent) {
		if (!containerEl) return;
		dragIndex = index;
		containerEl.setPointerCapture(e.pointerId);
		e.preventDefault();
	}

	function handlePointerMove(e: PointerEvent) {
		if (dragIndex < 0 || !containerEl) return;

		const rect = containerEl.getBoundingClientRect();
		const fx = (e.clientX - rect.left - dispRect.offsetX) / dispRect.dispW;
		const fy = (e.clientY - rect.top - dispRect.offsetY) / dispRect.dispH;

		corners[dragIndex] = {
			x: Math.max(0, Math.min(1, fx)),
			y: Math.max(0, Math.min(1, fy))
		};
		corners = [...corners];
		drawOverlay();

		const half = MAGNIFIER_SIZE / 2;
		const px = dispRect.offsetX + corners[dragIndex].x * dispRect.dispW;
		const py = dispRect.offsetY + corners[dragIndex].y * dispRect.dispH;

		let dx = px < rect.width / 2 ? MAGNIFIER_OFFSET : -MAGNIFIER_OFFSET;
		let dy = py < rect.height / 2 ? MAGNIFIER_OFFSET : -MAGNIFIER_OFFSET;

		if (px + dx - half < 0 || px + dx - half + MAGNIFIER_SIZE > rect.width) dx = -dx;
		if (py + dy - half < 0 || py + dy - half + MAGNIFIER_SIZE > rect.height) dy = -dy;

		magnifierPos = {
			x: Math.max(0, Math.min(rect.width - MAGNIFIER_SIZE, px + dx - half)),
			y: Math.max(0, Math.min(rect.height - MAGNIFIER_SIZE, py + dy - half))
		};

		if (capturedImage && magnifierCanvasEl) {
			const halfRegion = MAGNIFIER_SIZE / (2 * ZOOM);
			const sx = corners[dragIndex].x * imageWidth - halfRegion;
			const sy = corners[dragIndex].y * imageHeight - halfRegion;
			const sz = MAGNIFIER_SIZE / ZOOM;

			const dpr = window.devicePixelRatio || 1;
			magnifierCanvasEl.width = MAGNIFIER_SIZE * dpr;
			magnifierCanvasEl.height = MAGNIFIER_SIZE * dpr;
			const mctx = magnifierCanvasEl.getContext('2d')!;
			mctx.scale(dpr, dpr);
			mctx.imageSmoothingEnabled = false;
			mctx.clearRect(0, 0, MAGNIFIER_SIZE, MAGNIFIER_SIZE);
			mctx.drawImage(capturedImage, sx, sy, sz, sz, 0, 0, MAGNIFIER_SIZE, MAGNIFIER_SIZE);

			const cx = MAGNIFIER_SIZE / 2;
			const cy = MAGNIFIER_SIZE / 2;
			mctx.save();
			mctx.shadowColor = 'rgba(0,0,0,0.3)';
			mctx.shadowBlur = 4;
			mctx.beginPath();
			mctx.arc(cx, cy, 5, 0, Math.PI * 2);
			mctx.fillStyle = '#ffffff';
			mctx.fill();
			mctx.restore();
		}
	}

	function handlePointerUp() {
		if (dragIndex >= 0) {
			// Adjusting only manipulates the original-image overlay; the warp +
			// filter run once on Done, not on every drag release.
			drawOverlay();
		}
		dragIndex = -1;
	}

	function toggleFilters() {
		showFilters = !showFilters;
	}

	function handleRetake() {
		showFilters = false;
		onretake();
	}

	function applyFilter(value: FilterType) {
		if (value === filterType) return;
		filterType = value;
		renderFilter(value);
	}

	function rotateCW() {
		rotation = ((rotation + 90) % 360) as 0 | 90 | 180 | 270;
	}

	async function openAdjust() {
		showFilters = false;
		cornersBeforeAdjust = corners.map((c) => ({ ...c }));
		showAdjust = true;
		onadjustchange?.(true);
		await tick(); // mount the adjust block so overlayCanvasEl/containerEl bind
		computeDispRect();
		drawOverlay();
	}

	async function doneAdjust() {
		showAdjust = false;
		onadjustchange?.(false);
		await tick(); // mount the preview block so resultCanvasEl binds before extract
		doExtract();
	}

	// Leave Adjust without keeping any corner edits. Restores the pre-adjust
	// corners and re-extracts, since switching back to the preview remounts a
	// fresh (blank) resultCanvasEl that must be repainted with the original crop.
	async function cancelAdjust() {
		corners = cornersBeforeAdjust.map((c) => ({ ...c }));
		showAdjust = false;
		onadjustchange?.(false);
		await tick();
		doExtract();
	}

	function resetAdjust() {
		detectCorners();
		computeDispRect();
		drawOverlay();
	}

	// Bakes rotation into the final pixels and returns a page ready for PDF
	// assembly. Filters are already baked into resultCanvasEl by renderFilter.
	function bakePage(): FinishedPage | null {
		if (!resultCanvasEl) return null;

		const needsSwap = rotation === 90 || rotation === 270;
		const srcW = resultCanvasEl.width;
		const srcH = resultCanvasEl.height;
		const outW = needsSwap ? srcH : srcW;
		const outH = needsSwap ? srcW : srcH;

		const tempCanvas = document.createElement('canvas');
		tempCanvas.width = outW;
		tempCanvas.height = outH;
		const ctx = tempCanvas.getContext('2d')!;

		ctx.translate(outW / 2, outH / 2);
		ctx.rotate((rotation * Math.PI) / 180);
		ctx.drawImage(resultCanvasEl, -srcW / 2, -srcH / 2);

		return {
			id: crypto.randomUUID(),
			dataUrl: tempCanvas.toDataURL('image/jpeg', 0.95),
			width: outW,
			height: outH
		};
	}

	function handleDone() {
		const page = bakePage();
		if (!page) return;
		baking = true;
		ondone(page);
	}
</script>

{#if showAdjust}
	<div class="flex min-h-0 flex-1 flex-col">
		<p class="adjust-hint">Drag the corners to line up with the page edges</p>
		<div class="min-h-0 flex-1 px-0">
			<div
				bind:this={containerEl}
				role="application"
				class="relative h-full touch-none select-none overflow-hidden"
				onpointermove={handlePointerMove}
				onpointerup={handlePointerUp}
				onpointercancel={handlePointerUp}
			>
				<canvas bind:this={overlayCanvasEl} class="block h-full w-full object-contain"></canvas>
				{#each corners as corner, i (i)}
					<button
						type="button"
						class="adjust-handle"
						style="left: {dispRect.offsetX + corner.x * dispRect.dispW}px; top: {dispRect.offsetY +
							corner.y * dispRect.dispH}px; transform: translate(-50%, -50%) scale({dragIndex === i
							? 2.5
							: 1}); z-index: {dragIndex === i ? 30 : 10};"
						onpointerdown={(e) => handlePointerDown(i, e)}
						aria-label="Drag corner {HANDLE_LABELS[i]}"
					></button>
				{/each}
				{#if dragIndex >= 0}
					<canvas
						bind:this={magnifierCanvasEl}
						class="pointer-events-none absolute z-50 rounded-full border-4 border-white shadow-2xl"
						style="left: {magnifierPos.x}px; top: {magnifierPos.y}px; width: {MAGNIFIER_SIZE}px; height: {MAGNIFIER_SIZE}px;"
					></canvas>
				{/if}
			</div>
		</div>
		<div class="action-bar">
			<button type="button" class="tool-btn" onclick={cancelAdjust}>
				<X class="h-[22px] w-[22px]" />
				<span>Cancel</span>
			</button>
			<button type="button" class="tool-btn" onclick={resetAdjust}>
				<RotateCcw class="h-[22px] w-[22px]" />
				<span>Reset</span>
			</button>
			<button type="button" class="tool-btn tool-btn--primary" onclick={doneAdjust}>
				<Check class="h-[22px] w-[22px]" />
				<span>Apply</span>
			</button>
		</div>
	</div>
{:else}
	<div class="flex min-h-0 flex-1 flex-col">
		<div
			class="result-stage relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-muted/20 p-2"
		>
			<canvas
				bind:this={resultCanvasEl}
				class="result-canvas rounded-lg object-contain shadow-sm"
				class:is-rotated={rotation % 180 !== 0}
				class:invisible={scanning}
				style="transform: rotate({rotation}deg);"
			></canvas>

			{#if scanning}
				<div class="scan-overlay" out:fade={{ duration: 220 }}>
					<div class="scan-frame">
						<img class="scan-photo" src={dataUrl} alt="" />
						<span class="scan-bracket scan-bracket-tl"></span>
						<span class="scan-bracket scan-bracket-tr"></span>
						<span class="scan-bracket scan-bracket-br"></span>
						<span class="scan-bracket scan-bracket-bl"></span>
						<div class="scan-sweep"></div>
					</div>
					<p class="scan-caption">Finding document…</p>
				</div>
			{/if}
		</div>

		{#if showFilters}
			<div class="filter-strip">
				{#each FILTERS as f (f.value)}
					<button
						type="button"
						class="filter-tile"
						class:is-active={filterType === f.value}
						onclick={() => applyFilter(f.value)}
						disabled={scanning || baking}
						aria-pressed={filterType === f.value}
					>
						<span class="filter-thumb">
							{#if filterThumbs[f.value]}
								<img src={filterThumbs[f.value]} alt="" />
							{/if}
						</span>
						<span class="filter-label">{f.label}</span>
					</button>
				{/each}
			</div>
		{/if}

		<div class="action-bar">
			<button type="button" class="tool-btn" onclick={handleRetake} disabled={baking}>
				<Camera class="h-[22px] w-[22px]" />
				<span>Retake</span>
			</button>
			<button type="button" class="tool-btn" onclick={openAdjust} disabled={baking || scanning}>
				<Crop class="h-[22px] w-[22px]" />
				<span>Adjust</span>
			</button>
			<button type="button" class="tool-btn" onclick={rotateCW} disabled={baking || scanning}>
				<RotateCw class="h-[22px] w-[22px]" />
				<span>Rotate</span>
			</button>
			<button
				type="button"
				class="tool-btn"
				class:is-active={showFilters}
				onclick={toggleFilters}
				disabled={baking || scanning}
				aria-pressed={showFilters}
			>
				<Contrast class="h-[22px] w-[22px]" />
				<span>Filter</span>
			</button>
			<button
				type="button"
				class="tool-btn tool-btn--primary"
				onclick={handleDone}
				disabled={baking || scanning}
			>
				<Check class="h-[22px] w-[22px]" />
				<span>Save</span>
			</button>
		</div>
	</div>
{/if}

<style>
	/* Size container so the canvas can be constrained by container-query units,
	   letting a CSS-rotated image fit the stage even when width/height swap. */
	.result-stage {
		container-type: size;
	}

	.result-canvas {
		max-width: 100cqw;
		max-height: 100cqh;
	}

	/* At 90°/270° the rotated bbox swaps axes, so constrain the un-rotated
	   canvas to the container's opposite dimensions and it fits after rotating. */
	.result-canvas.is-rotated {
		max-width: 100cqh;
		max-height: 100cqw;
	}

	.scan-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 0.5rem;
	}

	.scan-frame {
		position: relative;
		display: inline-flex;
		max-width: 100%;
		max-height: 100%;
	}

	.scan-photo {
		display: block;
		max-width: 100%;
		max-height: 100%;
		border-radius: 0.5rem;
		opacity: 0.85;
	}

	.scan-sweep {
		position: absolute;
		left: 0;
		right: 0;
		top: 2%;
		height: 2px;
		background: linear-gradient(90deg, transparent, var(--primary), transparent);
		box-shadow: 0 0 16px 3px color-mix(in oklch, var(--primary) 70%, transparent);
		animation: scan-sweep 1.5s ease-in-out infinite;
	}

	@keyframes scan-sweep {
		0% {
			top: 2%;
			opacity: 0;
		}
		15% {
			opacity: 1;
		}
		85% {
			opacity: 1;
		}
		100% {
			top: 98%;
			opacity: 0;
		}
	}

	.scan-bracket {
		position: absolute;
		width: 22px;
		height: 22px;
		border: 2.5px solid var(--primary);
		animation: scan-bracket-pulse 1.5s ease-in-out infinite;
	}

	.scan-bracket-tl {
		top: 7px;
		left: 7px;
		border-right: none;
		border-bottom: none;
		border-top-left-radius: 6px;
	}
	.scan-bracket-tr {
		top: 7px;
		right: 7px;
		border-left: none;
		border-bottom: none;
		border-top-right-radius: 6px;
	}
	.scan-bracket-br {
		bottom: 7px;
		right: 7px;
		border-left: none;
		border-top: none;
		border-bottom-right-radius: 6px;
	}
	.scan-bracket-bl {
		bottom: 7px;
		left: 7px;
		border-right: none;
		border-top: none;
		border-bottom-left-radius: 6px;
	}

	@keyframes scan-bracket-pulse {
		0%,
		100% {
			opacity: 0.55;
		}
		50% {
			opacity: 1;
		}
	}

	.scan-caption {
		margin-top: 14px;
		font-size: 12.5px;
		font-weight: 500;
		letter-spacing: 0.01em;
		color: var(--muted-foreground);
	}

	.action-bar {
		display: flex;
		align-items: stretch;
		gap: 6px;
		border-top: 1px solid var(--border);
		background: var(--background);
		/* Match the main bottom nav: 56px content + safe-area inset. The 6px top/bottom
		   inset keeps the active/primary button highlight from filling the full height. */
		height: calc(56px + var(--safe-bottom));
		padding: 6px 10px calc(var(--safe-bottom) + 6px);
	}

	.tool-btn {
		flex: 1 1 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 5px;
		min-height: 0;
		padding: 8px 4px;
		border: none;
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--muted-foreground);
		font-size: 11px;
		font-weight: 500;
		line-height: 1;
		cursor: pointer;
		transition:
			background-color 0.15s,
			color 0.15s,
			transform 0.1s;
	}

	/* hover only on real pointers — on touch, :hover sticks after a tap */
	@media (hover: hover) {
		.tool-btn:not(:disabled):hover {
			background: var(--accent);
			color: var(--foreground);
		}
	}

	.tool-btn:not(:disabled):active {
		transform: scale(0.95);
	}

	.tool-btn:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}

	.tool-btn:disabled {
		opacity: 0.4;
		cursor: default;
	}

	.tool-btn.is-active {
		background: var(--primary-soft);
		color: var(--primary);
	}

	.tool-btn--primary {
		background: var(--primary);
		color: var(--primary-foreground);
	}

	@media (hover: hover) {
		.tool-btn--primary:not(:disabled):hover {
			background: color-mix(in oklch, var(--primary) 92%, black);
			color: var(--primary-foreground);
		}
	}

	.adjust-hint {
		flex-shrink: 0;
		padding: 10px 16px;
		text-align: center;
		font-size: 12.5px;
		font-weight: 500;
		letter-spacing: 0.01em;
		color: var(--muted-foreground);
	}

	.adjust-handle {
		position: absolute;
		width: 28px;
		height: 28px;
		border-radius: 999px;
		border: 2px solid var(--primary);
		background: #fff;
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
		touch-action: none;
		cursor: grab;
		transition: transform 0.15s;
	}

	.adjust-handle:active {
		cursor: grabbing;
	}

	.adjust-handle:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}

	.filter-strip {
		display: flex;
		gap: 12px;
		overflow-x: auto;
		border-top: 1px solid var(--border);
		background: var(--background);
		padding: 12px 14px;
		scrollbar-width: none;
	}
	.filter-strip::-webkit-scrollbar {
		display: none;
	}

	.filter-tile {
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		background: none;
		border: none;
		padding: 0;
		cursor: pointer;
	}
	.filter-tile:disabled {
		cursor: default;
	}

	.filter-thumb {
		display: block;
		width: 52px;
		height: 66px;
		border-radius: 9px;
		overflow: hidden;
		background: var(--muted);
		border: 2px solid transparent;
		transition:
			border-color 0.15s,
			transform 0.12s;
	}
	.filter-thumb img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.filter-tile.is-active .filter-thumb {
		border-color: var(--primary);
	}
	.filter-tile:not(:disabled):active .filter-thumb {
		transform: scale(0.95);
	}
	.filter-tile:focus-visible .filter-thumb {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}

	.filter-label {
		font-size: 11px;
		font-weight: 500;
		color: var(--muted-foreground);
		transition: color 0.15s;
	}
	.filter-tile.is-active .filter-label {
		color: var(--foreground);
	}

	@media (prefers-reduced-motion: reduce) {
		.scan-sweep {
			animation: none;
			top: 50%;
			opacity: 0.9;
		}
		.scan-bracket {
			animation: none;
			opacity: 0.9;
		}
	}
</style>
