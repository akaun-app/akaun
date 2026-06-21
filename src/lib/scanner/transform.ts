import type { Quad } from './types';
import { getCv } from './cv';
import { distance } from './geometry';

// Output dimensions for the warped document, derived from the quad's edge lengths
// so the result preserves the document's true aspect ratio rather than stretching
// it to the source image's dimensions.
//   width  = max(top edge, bottom edge)
//   height = max(left edge, right edge)
export function outputSizeFromQuad(quad: Quad): { width: number; height: number } {
	const { topLeft, topRight, bottomRight, bottomLeft } = quad;
	const width = Math.max(distance(topLeft, topRight), distance(bottomLeft, bottomRight));
	const height = Math.max(distance(topLeft, bottomLeft), distance(topRight, bottomRight));
	return { width: Math.round(width), height: Math.round(height) };
}

// Perspective-warps the document region defined by quad onto a flat canvas sized to
// the document's own aspect ratio.
export function extractPaper(
	image: HTMLImageElement | HTMLCanvasElement,
	quad: Quad
): HTMLCanvasElement | null {
	const cv = getCv();
	if (!cv) return null;

	const { topLeft, topRight, bottomRight, bottomLeft } = quad;
	if (!topLeft || !topRight || !bottomRight || !bottomLeft) return null;

	const { width: resultWidth, height: resultHeight } = outputSizeFromQuad(quad);
	if (resultWidth < 1 || resultHeight < 1) return null;

	const canvas = document.createElement('canvas');
	const img = cv.imread(image);
	const warpedDst = new cv.Mat();
	const dsize = new cv.Size(resultWidth, resultHeight);

	// srcTri order must match dstTri order (TL, TR, BL, BR).
	const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
		topLeft.x, topLeft.y,
		topRight.x, topRight.y,
		bottomLeft.x, bottomLeft.y,
		bottomRight.x, bottomRight.y
	]);

	const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
		0, 0,
		resultWidth, 0,
		0, resultHeight,
		resultWidth, resultHeight
	]);

	try {
		const M = cv.getPerspectiveTransform(srcTri, dstTri);
		cv.warpPerspective(img, warpedDst, M, dsize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());
		cv.imshow(canvas, warpedDst);
		M.delete();
	} finally {
		img.delete();
		warpedDst.delete();
		srcTri.delete();
		dstTri.delete();
	}

	return canvas;
}
