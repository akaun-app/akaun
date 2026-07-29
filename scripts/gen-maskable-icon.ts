/**
 * Regenerates `static/icons/icon-maskable-512.png` from `static/icons/icon-512.png`.
 *
 * The maskable variant used to be a byte-for-byte copy of the normal icon, which
 * is wrong: Android crops maskable icons to a circle/squircle of its choosing and
 * only guarantees the centre 80% ("safe zone") survives. A copy of the standard
 * icon has its own rounded-square silhouette with transparent corners, so the
 * crop ate into the artwork.
 *
 * This produces a proper maskable asset: the brand colour bled edge-to-edge
 * (no transparency, so any mask shape looks intentional) with the logo scaled
 * down and centred so the glyph sits well inside the safe zone.
 *
 * Run with: bun run scripts/gen-maskable-icon.ts
 */
import { readFileSync, writeFileSync } from 'fs';
import { PNG } from 'pngjs';

const SRC = 'static/icons/icon-512.png';
const DEST = 'static/icons/icon-maskable-512.png';

/** Fraction of the canvas the source logo is scaled to. Keeps the glyph inside
 *  Android's centre-80% safe zone with room to spare. */
const LOGO_SCALE = 0.72;

/** Area-average (box filter) downscale — the right resampler for shrinking, and
 *  it avoids the aliasing a naive nearest-neighbour pick would produce. Operates
 *  on premultiplied alpha so transparent pixels don't bleed dark edges. */
function downscale(src: PNG, size: number): PNG {
	const out = new PNG({ width: size, height: size });
	const ratio = src.width / size;

	for (let y = 0; y < size; y++) {
		const y0 = Math.floor(y * ratio);
		const y1 = Math.min(src.height, Math.ceil((y + 1) * ratio));
		for (let x = 0; x < size; x++) {
			const x0 = Math.floor(x * ratio);
			const x1 = Math.min(src.width, Math.ceil((x + 1) * ratio));

			let r = 0,
				g = 0,
				b = 0,
				a = 0,
				n = 0;
			for (let sy = y0; sy < y1; sy++) {
				for (let sx = x0; sx < x1; sx++) {
					const i = (sy * src.width + sx) * 4;
					const alpha = src.data[i + 3] / 255;
					r += src.data[i] * alpha;
					g += src.data[i + 1] * alpha;
					b += src.data[i + 2] * alpha;
					a += src.data[i + 3];
					n++;
				}
			}

			const o = (y * size + x) * 4;
			const avgA = a / n;
			// Un-premultiply back to straight alpha for storage.
			const k = avgA > 0 ? 255 / avgA : 0;
			out.data[o] = Math.round((r / n) * k);
			out.data[o + 1] = Math.round((g / n) * k);
			out.data[o + 2] = Math.round((b / n) * k);
			out.data[o + 3] = Math.round(avgA);
		}
	}
	return out;
}

/** Picks the logo's background colour by sampling opaque pixels along the top
 *  edge of the artwork, away from the centred glyph. */
function sampleBackground(src: PNG): [number, number, number] {
	const mid = src.width >> 1;
	for (let y = 0; y < src.height >> 2; y++) {
		const i = (y * src.width + mid) * 4;
		if (src.data[i + 3] === 255) {
			return [src.data[i], src.data[i + 1], src.data[i + 2]];
		}
	}
	throw new Error(`could not find an opaque background pixel in ${SRC}`);
}

const src = PNG.sync.read(readFileSync(SRC));
if (src.width !== src.height) {
	throw new Error(`${SRC} must be square, got ${src.width}x${src.height}`);
}

const size = src.width;
const [br, bg, bb] = sampleBackground(src);
const logoSize = Math.round(size * LOGO_SCALE);
const logo = downscale(src, logoSize);
const offset = Math.round((size - logoSize) / 2);

const out = new PNG({ width: size, height: size });

// Full-bleed background.
for (let i = 0; i < out.data.length; i += 4) {
	out.data[i] = br;
	out.data[i + 1] = bg;
	out.data[i + 2] = bb;
	out.data[i + 3] = 255;
}

// Alpha-composite the scaled logo over it.
for (let y = 0; y < logoSize; y++) {
	for (let x = 0; x < logoSize; x++) {
		const s = (y * logoSize + x) * 4;
		const alpha = logo.data[s + 3] / 255;
		if (alpha === 0) continue;
		const d = ((y + offset) * size + (x + offset)) * 4;
		for (let c = 0; c < 3; c++) {
			out.data[d + c] = Math.round(logo.data[s + c] * alpha + out.data[d + c] * (1 - alpha));
		}
	}
}

writeFileSync(DEST, PNG.sync.write(out));
console.log(
	`wrote ${DEST} — ${size}x${size}, bg rgb(${br},${bg},${bb}), logo at ${Math.round(LOGO_SCALE * 100)}%`
);
