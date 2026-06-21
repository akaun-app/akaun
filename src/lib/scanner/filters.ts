import { getCv, FILTER } from './cv';

// Post-process filters for the warped document canvas. Each filter mutates the
// canvas in place, wraps its OpenCV work in try/catch with a pure-canvas fallback,
// and frees every Mat in `finally`. Optional ops (bilateral, adaptive threshold)
// are feature-detected so a leaner opencv.js build degrades gracefully.

// --- shared helpers -------------------------------------------------------

// Background-illumination kernel: a fraction of the larger image dimension,
// clamped to a sane odd range.
function bgBlurKernel(maxDim: number): number {
	let k = Math.round(maxDim * FILTER.BG_BLUR_RATIO);
	k = Math.max(FILTER.BG_BLUR_MIN, Math.min(FILTER.BG_BLUR_MAX, k));
	if (k % 2 === 0) k += 1;
	return k;
}

// Local neighborhood (forced odd) for adaptive thresholding, sized to a fraction
// of the larger image dimension and clamped to a sane range.
function adaptiveBlock(maxDim: number): number {
	let b = Math.round(maxDim * FILTER.ADAPTIVE_BLOCK_RATIO);
	b = Math.max(FILTER.ADAPTIVE_BLOCK_MIN, Math.min(FILTER.ADAPTIVE_BLOCK_MAX, b));
	if (b % 2 === 0) b += 1;
	return b;
}

// Sauvola local window (forced odd), sized to a fraction of the larger dimension
// and clamped to a sane range.
function sauvolaWindow(maxDim: number): number {
	let w = Math.round(maxDim * FILTER.SAUVOLA_WINDOW_RATIO);
	w = Math.max(FILTER.SAUVOLA_WINDOW_MIN, Math.min(FILTER.SAUVOLA_WINDOW_MAX, w));
	if (w % 2 === 0) w += 1;
	return w;
}

// Whether this opencv.js build exposes the Mat ops Sauvola binarization needs.
function canSauvola(cv: any): boolean {
	return (
		typeof cv.boxFilter === 'function' &&
		typeof cv.multiply === 'function' &&
		typeof cv.subtract === 'function' &&
		typeof cv.add === 'function' &&
		typeof cv.sqrt === 'function' &&
		typeof cv.compare === 'function' &&
		typeof cv.threshold === 'function'
	);
}

// Edge-preserving denoise into `dst` (must differ from `src`). Prefers a light
// bilateral filter, falls back to a 3×3 Gaussian, else copies through.
function denoise(cv: any, src: any, dst: any): void {
	if (typeof cv.bilateralFilter === 'function') {
		try {
			cv.bilateralFilter(src, dst, 5, 40, 40, cv.BORDER_DEFAULT);
			return;
		} catch {
			/* fall through */
		}
	}
	if (typeof cv.GaussianBlur === 'function') {
		try {
			cv.GaussianBlur(src, dst, new cv.Size(3, 3), 0);
			return;
		} catch {
			/* fall through */
		}
	}
	src.copyTo(dst);
}

// --- B&W (clean scan) -----------------------------------------------------

// Dispatcher: pick the best available B&W binarization for this opencv.js build.
// Sauvola (local mean + std-dev threshold) is preferred — it keeps backgrounds
// clean and strokes solid/smooth where plain adaptive-mean thresholding leaves
// speckle and ragged edges. Degrades to adaptive-mean, then Otsu, then a
// pure-canvas threshold.
export function applyBWFilter(canvas: HTMLCanvasElement): void {
	const cv = getCv();
	if (!cv?.Mat) {
		applyBWFallback(canvas);
		return;
	}
	if (canSauvola(cv)) {
		applyBWSauvola(canvas);
		return;
	}
	if (typeof cv.adaptiveThreshold === 'function') {
		applyBWAdaptive(canvas);
		return;
	}
	applyBWOtsu(canvas);
}

// Sauvola binarization: threshold T = m·(1 + k·(s/R − 1)) per pixel, where m and s
// are the local mean and standard deviation over a sliding window. In smooth paper
// s is small so T drops below the mean and noise stays white; at a stroke edge s is
// large so T rises and the whole stroke is captured solidly. Local mean/variance
// are computed with boxFilter (matrix ops) rather than a per-pixel JS loop.
function applyBWSauvola(canvas: HTMLCanvasElement): void {
	const cv = getCv();
	const src = cv.imread(canvas);
	const gray = new cv.Mat();
	const denoised = new cv.Mat();
	const f = new cv.Mat();
	const mean = new cv.Mat();
	const sq = new cv.Mat();
	const meanSq = new cv.Mat();
	const variance = new cv.Mat();
	const std = new cv.Mat();
	const factor = new cv.Mat();
	const tmp = new cv.Mat();
	const t = new cv.Mat();
	const bw = new cv.Mat();
	const rgba = new cv.Mat();
	try {
		cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
		denoise(cv, gray, denoised);
		denoised.convertTo(f, cv.CV_32F);

		const w = sauvolaWindow(Math.max(gray.rows, gray.cols));
		const ks = new cv.Size(w, w);
		const anchor = new cv.Point(-1, -1);

		// Local mean and mean-of-squares -> variance -> std.
		cv.boxFilter(f, mean, cv.CV_32F, ks, anchor, true, cv.BORDER_REFLECT);
		cv.multiply(f, f, sq);
		cv.boxFilter(sq, meanSq, cv.CV_32F, ks, anchor, true, cv.BORDER_REFLECT);
		cv.multiply(mean, mean, tmp);
		cv.subtract(meanSq, tmp, variance);
		// Clamp tiny negative variances from float error so sqrt stays real.
		cv.threshold(variance, variance, 0, 0, cv.THRESH_TOZERO);
		cv.sqrt(variance, std);

		// factor = k·(std/R − 1); t = mean·(1 + factor) = mean + mean·factor.
		const k = FILTER.SAUVOLA_K;
		std.convertTo(factor, cv.CV_32F, k / FILTER.SAUVOLA_R, -k);
		cv.multiply(mean, factor, tmp);
		cv.add(mean, tmp, t);

		// White where pixel exceeds its local threshold (paper), black otherwise (text).
		cv.compare(f, t, bw, cv.CMP_GT);
		if (typeof cv.medianBlur === 'function') cv.medianBlur(bw, bw, 3);
		cv.cvtColor(bw, rgba, cv.COLOR_GRAY2RGBA);
		cv.imshow(canvas, rgba);
	} catch {
		applyBWFallback(canvas);
	} finally {
		src.delete();
		gray.delete();
		denoised.delete();
		f.delete();
		mean.delete();
		sq.delete();
		meanSq.delete();
		variance.delete();
		std.delete();
		factor.delete();
		tmp.delete();
		t.delete();
		bw.delete();
		rgba.delete();
	}
}

// Adaptive-mean thresholding fallback: per-region Gaussian-weighted mean minus a
// constant. Keeps thin/faint strokes but leaves more speckle and rougher edges
// than Sauvola; used on builds lacking the Mat ops Sauvola needs.
function applyBWAdaptive(canvas: HTMLCanvasElement): void {
	const cv = getCv();
	const src = cv.imread(canvas);
	const gray = new cv.Mat();
	const denoised = new cv.Mat();
	const bw = new cv.Mat();
	const rgba = new cv.Mat();
	try {
		cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
		denoise(cv, gray, denoised);
		const block = adaptiveBlock(Math.max(gray.rows, gray.cols));
		cv.adaptiveThreshold(
			denoised,
			bw,
			255,
			cv.ADAPTIVE_THRESH_GAUSSIAN_C,
			cv.THRESH_BINARY,
			block,
			FILTER.ADAPTIVE_C
		);
		if (typeof cv.medianBlur === 'function') cv.medianBlur(bw, bw, 3);
		cv.cvtColor(bw, rgba, cv.COLOR_GRAY2RGBA);
		cv.imshow(canvas, rgba);
	} catch {
		applyBWFallback(canvas);
	} finally {
		src.delete();
		gray.delete();
		denoised.delete();
		bw.delete();
		rgba.delete();
	}
}

// Legacy fallback: illumination-normalize then Otsu-threshold in place. Dividing
// the gray image by a heavily-blurred copy of itself flattens shadows and paper
// texture so a single global threshold can work. Only used on builds lacking
// adaptiveThreshold.
function applyBWOtsu(canvas: HTMLCanvasElement): void {
	const cv = getCv();
	const src = cv.imread(canvas);
	const gray = new cv.Mat();
	const bg = new cv.Mat();
	const norm = new cv.Mat();
	const bw = new cv.Mat();
	const rgba = new cv.Mat();
	let kernel: any = null;
	try {
		cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
		const k = bgBlurKernel(Math.max(gray.rows, gray.cols));
		cv.blur(gray, bg, new cv.Size(k, k));
		cv.divide(gray, bg, norm, 255);
		cv.threshold(norm, bw, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
		const mk = FILTER.MORPH_KERNEL;
		kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(mk, mk));
		cv.morphologyEx(bw, bw, cv.MORPH_OPEN, kernel);
		cv.cvtColor(bw, rgba, cv.COLOR_GRAY2RGBA);
		cv.imshow(canvas, rgba);
	} catch {
		applyBWFallback(canvas);
	} finally {
		src.delete();
		gray.delete();
		bg.delete();
		norm.delete();
		bw.delete();
		rgba.delete();
		kernel?.delete?.();
	}
}

function applyBWFallback(canvas: HTMLCanvasElement): void {
	const ctx = canvas.getContext('2d')!;
	const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
	const data = imageData.data;
	for (let i = 0; i < data.length; i += 4) {
		const g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
		const v = g > 150 ? 255 : 0;
		data[i] = v;
		data[i + 1] = v;
		data[i + 2] = v;
	}
	ctx.putImageData(imageData, 0, 0);
}

// --- Grayscale (plain) ----------------------------------------------------

// Pure color→gray conversion (luma weights), no enhancement. Document brightness/
// contrast enhancement is deferred to a future "document enhancer" feature.
export function applyGrayscaleFilter(canvas: HTMLCanvasElement): void {
	const ctx = canvas.getContext('2d')!;
	const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
	const data = imageData.data;
	for (let i = 0; i < data.length; i += 4) {
		const g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
		data[i] = data[i + 1] = data[i + 2] = g;
	}
	ctx.putImageData(imageData, 0, 0);
}

