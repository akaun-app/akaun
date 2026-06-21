import type { Point, Quad } from './types';
import { getCv, TAG, DETECTION } from './cv';
import { resizeToProxy } from './image';
import { scaleQuad } from './geometry';

// Orders 4 points as TL/TR/BR/BL using sum/diff of coordinates.
// More reliable than centroid+polar for rotated documents.
//   Top-Left  = min(x+y)      Bottom-Right = max(x+y)
//   Top-Right = max(x-y)      Bottom-Left  = min(x-y)
function orderCorners(pts: Point[]): Quad {
	const sum = pts.map((p) => p.x + p.y);
	const diff = pts.map((p) => p.x - p.y);
	return {
		topLeft: pts[sum.indexOf(Math.min(...sum))],
		bottomRight: pts[sum.indexOf(Math.max(...sum))],
		topRight: pts[diff.indexOf(Math.max(...diff))],
		bottomLeft: pts[diff.indexOf(Math.min(...diff))]
	};
}

// Converts a 4-row contour Mat to a Quad (ordered TL/TR/BR/BL).
function contourToQuad(contour: any): Quad {
	const pts: Point[] = [];
	for (let i = 0; i < 4; i++) {
		pts.push({ x: contour.data32S[i * 2], y: contour.data32S[i * 2 + 1] });
	}
	return orderCorners(pts);
}

// Corners of a cv.minAreaRect() result ({center, size, angle}), matching
// OpenCV's own cv::RotatedRect::points() formula (no boxPoints binding exposed).
function minAreaRectCorners(rect: { center: Point; size: { width: number; height: number }; angle: number }): Quad {
	const { center, size, angle } = rect;
	const rad = (angle * Math.PI) / 180;
	const b = Math.cos(rad) * 0.5;
	const a = Math.sin(rad) * 0.5;

	const p0: Point = {
		x: center.x - a * size.height - b * size.width,
		y: center.y + b * size.height - a * size.width
	};
	const p1: Point = {
		x: center.x + a * size.height - b * size.width,
		y: center.y - b * size.height - a * size.width
	};
	const p2: Point = { x: 2 * center.x - p0.x, y: 2 * center.y - p0.y };
	const p3: Point = { x: 2 * center.x - p1.x, y: 2 * center.y - p1.y };

	return orderCorners([p0, p1, p2, p3]);
}

// Runs GrabCut on a small downscaled proxy of `source` to segment the document
// from its background, then reduces the resulting foreground mask to a quad and
// scales it back up to full resolution. GrabCut is far more robust to cluttered
// backgrounds and uneven lighting than the previous edge/threshold-based contour
// search, but is too slow to run at full photo resolution.
//
// Returns null if the foreground mask is degenerate (covers almost all or almost
// none of the proxy frame) — callers should fall back to a fixed inset rectangle.
export function detectDocumentQuad(
	source: HTMLCanvasElement | HTMLImageElement,
	verbose = import.meta.env.DEV
): Quad | null {
	const cv = getCv();
	if (!cv) return null;

	const { canvas: proxyCanvas, scaleX, scaleY } = resizeToProxy(source, DETECTION.PROXY_MAX_DIM);
	const proxyW = proxyCanvas.width;
	const proxyH = proxyCanvas.height;

	if (verbose) console.groupCollapsed(`${TAG} detectDocumentQuad proxy ${proxyW}×${proxyH}`);

	const img = cv.imread(proxyCanvas);
	const mask = new cv.Mat();
	const bgdModel = new cv.Mat();
	const fgdModel = new cv.Mat();
	const fgMask = new cv.Mat(proxyH, proxyW, cv.CV_8UC1, new cv.Scalar(0));
	let contours: any = null;
	let hierarchy: any = null;
	let hull: any = null;
	let approx: any = null;

	try {
		const marginX = Math.round(proxyW * DETECTION.RECT_MARGIN_RATIO);
		const marginY = Math.round(proxyH * DETECTION.RECT_MARGIN_RATIO);
		const rect = new cv.Rect(marginX, marginY, proxyW - 2 * marginX, proxyH - 2 * marginY);

		// Convert RGBA -> BGR: grabCut expects a 3-channel image.
		const bgr = new cv.Mat();
		cv.cvtColor(img, bgr, cv.COLOR_RGBA2BGR);
		try {
			cv.grabCut(bgr, mask, rect, bgdModel, fgdModel, DETECTION.GRABCUT_ITER, cv.GC_INIT_WITH_RECT);
		} finally {
			bgr.delete();
		}

		// GC_FGD = 1, GC_PR_FGD = 3 — both count as foreground (odd values).
		let fgCount = 0;
		const total = proxyW * proxyH;
		for (let i = 0; i < total; i++) {
			if (mask.data[i] & 1) {
				fgMask.data[i] = 255;
				fgCount++;
			}
		}

		const fgRatio = fgCount / total;
		if (fgRatio < DETECTION.MIN_FOREGROUND_RATIO || fgRatio > DETECTION.MAX_FOREGROUND_RATIO) {
			if (verbose) console.warn(`${TAG} grabCut foreground ratio out of bounds (${fgRatio.toFixed(2)})`);
			return null;
		}

		contours = new cv.MatVector();
		hierarchy = new cv.Mat();
		cv.findContours(fgMask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

		let largest: any = null;
		let largestArea = 0;
		for (let i = 0; i < contours.size(); i++) {
			const c = contours.get(i);
			const area = cv.contourArea(c);
			if (area > largestArea) {
				largest?.delete();
				largestArea = area;
				largest = c;
			} else {
				c.delete();
			}
		}
		if (!largest) {
			if (verbose) console.warn(`${TAG} grabCut produced no contour`);
			return null;
		}

		hull = new cv.Mat();
		cv.convexHull(largest, hull);
		largest.delete();

		let quad: Quad | null = null;
		const peri = cv.arcLength(hull, true);
		for (
			let epsilonRatio = DETECTION.APPROX_EPSILON_START;
			epsilonRatio <= DETECTION.APPROX_EPSILON_MAX;
			epsilonRatio += DETECTION.APPROX_EPSILON_STEP
		) {
			approx?.delete();
			approx = new cv.Mat();
			cv.approxPolyDP(hull, approx, epsilonRatio * peri, true);
			if (approx.rows === 4 && cv.isContourConvex(approx)) {
				quad = contourToQuad(approx);
				break;
			}
		}

		if (!quad) {
			if (verbose) console.log(`${TAG} no 4-point approx — falling back to minAreaRect`);
			const rotated = cv.minAreaRect(hull);
			quad = minAreaRectCorners(rotated);
		}

		if (verbose) console.log(`${TAG} quad found ✓ (proxy space)`);
		return scaleQuad(quad, scaleX, scaleY);
	} finally {
		img.delete();
		mask.delete();
		bgdModel.delete();
		fgdModel.delete();
		fgMask.delete();
		contours?.delete();
		hierarchy?.delete();
		hull?.delete();
		approx?.delete();
		if (verbose) console.groupEnd();
	}
}
