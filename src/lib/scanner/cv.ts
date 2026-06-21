// Central access point for the OpenCV.js runtime and shared tuning constants.
//
// OpenCV.js attaches itself to `window.cv` and ships no TypeScript types, so we
// expose a single typed-ish accessor instead of sprinkling `(window as any).cv`
// across the codebase. `CvMat` documents intent at call sites without pretending
// the bindings are typed.

export type CvMat = any;

export function getCv(): any {
	return (window as any).cv;
}

let loadPromise: Promise<void> | null = null;

// Lazily injects opencv.js exactly once for the page's lifetime and resolves
// once its runtime is ready. Safe to call every time the scanner opens — this
// caches the single in-flight/resolved promise instead of re-injecting the
// script and re-waiting on a second open.
export function loadOpenCv(): Promise<void> {
	if (loadPromise) return loadPromise;

	loadPromise = new Promise((resolve, reject) => {
		const w = window as any;
		if (w.cv?.Mat) {
			resolve();
			return;
		}

		const script = document.createElement('script');
		script.src = '/opencv.js';
		script.async = true;

		// This build's UMD wrapper (`root.cv = factory()`) overwrites window.cv
		// with its own Module object once the script runs, discarding any
		// onRuntimeInitialized callback wired onto a pre-existing window.cv —
		// that hook never fires here. Poll for cv.Mat instead, which the wasm
		// runtime sets once it's actually ready.
		let poll = 0;
		let timeout = 0;
		const fail = (err: Error) => {
			clearInterval(poll);
			clearTimeout(timeout);
			loadPromise = null; // allow retry on a later open
			reject(err);
		};

		script.onerror = () => fail(new Error('Failed to load /opencv.js'));
		document.head.appendChild(script);

		poll = window.setInterval(() => {
			if (w.cv?.Mat) {
				clearInterval(poll);
				clearTimeout(timeout);
				resolve();
			}
		}, 100);

		// Guard against the script loading but the wasm runtime never initializing,
		// so the poll can't spin forever.
		timeout = window.setTimeout(() => fail(new Error('opencv.js init timed out')), 30000);
	});

	return loadPromise;
}

export const TAG = '[docscan]';

// GrabCut-based detection tuning. Detection runs on a small proxy image (longest
// side PROXY_MAX_DIM) since GrabCut is too slow to run at full photo resolution.
export const DETECTION = {
	// Longest side (px) of the proxy image GrabCut runs on.
	PROXY_MAX_DIM: 300,
	// Initial GrabCut rect is inset from the proxy edges by this fraction.
	RECT_MARGIN_RATIO: 0.03,
	GRABCUT_ITER: 5,
	// Foreground mask ratio must fall within these bounds, else detection is
	// treated as failed (caller falls back to a fixed inset rectangle).
	MIN_FOREGROUND_RATIO: 0.1,
	MAX_FOREGROUND_RATIO: 0.97,
	// approxPolyDP epsilon (fraction of contour perimeter) stepped upward until
	// the mask contour reduces to a convex quad.
	APPROX_EPSILON_START: 0.02,
	APPROX_EPSILON_STEP: 0.01,
	APPROX_EPSILON_MAX: 0.1,
} as const;

// Post-process filter tuning (EditView edit step). Kept separate from DETECTION,
// whose adaptive-threshold constants are tuned for contour finding, not output.
export const FILTER = {
	// B&W: background illumination is estimated by blurring with a kernel sized to
	// this fraction of the image's larger dimension (forced odd). Dividing the gray
	// image by this background flattens shadows/paper texture before thresholding.
	BG_BLUR_RATIO: 1 / 8,
	// Clamp the background-blur kernel to a sane odd range regardless of image size.
	BG_BLUR_MIN: 21,
	BG_BLUR_MAX: 151,
	// B&W speckle cleanup: morphological-open kernel (px) applied after thresholding.
	// Only used by the Otsu fallback path; the primary adaptive path uses medianBlur.
	MORPH_KERNEL: 2,
	// B&W adaptive thresholding (primary path). blockSize is the local neighborhood
	// (forced odd) sized to this fraction of the larger dimension, clamped sane.
	ADAPTIVE_BLOCK_RATIO: 1 / 30,
	ADAPTIVE_BLOCK_MIN: 15,
	ADAPTIVE_BLOCK_MAX: 51,
	// Constant subtracted from the local weighted mean. LOWER C => thicker / more
	// text retained (more black), higher C => thinner. ~7 retains fine strokes
	// without excessive background speckle.
	ADAPTIVE_C: 7,
	// B&W Sauvola binarization (primary path). Local window (forced odd) sized to a
	// fraction of the larger dimension; k controls aggressiveness (LOWER k => darker /
	// more text, higher k => cleaner background but lighter text); R is the 8-bit
	// std range.
	SAUVOLA_WINDOW_RATIO: 1 / 30,
	SAUVOLA_WINDOW_MIN: 15,
	SAUVOLA_WINDOW_MAX: 41,
	SAUVOLA_K: 0.25,
	SAUVOLA_R: 128,
} as const;
