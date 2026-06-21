// Draws `source` scaled down so its longest side is `maxDim`, preserving aspect
// ratio. Returns scale factors (full / proxy) for mapping detected coordinates
// in proxy space back to full resolution.
export function resizeToProxy(
	source: HTMLCanvasElement | HTMLImageElement,
	maxDim: number
): { canvas: HTMLCanvasElement; scaleX: number; scaleY: number } {
	const fullWidth = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
	const fullHeight = source instanceof HTMLImageElement ? source.naturalHeight : source.height;

	const scale = Math.min(1, maxDim / Math.max(fullWidth, fullHeight));
	const proxyWidth = Math.max(1, Math.round(fullWidth * scale));
	const proxyHeight = Math.max(1, Math.round(fullHeight * scale));

	const canvas = document.createElement('canvas');
	canvas.width = proxyWidth;
	canvas.height = proxyHeight;
	canvas.getContext('2d')!.drawImage(source, 0, 0, proxyWidth, proxyHeight);

	return { canvas, scaleX: fullWidth / proxyWidth, scaleY: fullHeight / proxyHeight };
}

// Loads an image bypassing browser ICC color profile conversion, so pixel
// values match Python's cv2.imread().
//
// Why this exists:
//   Python's cv2.imread() reads raw JPEG bytes — no EXIF rotation, no ICC color
//   profile conversion. But the browser's canvas 2D context applies ICC color
//   management (e.g. Display P3 → sRGB) when drawing an HTMLImageElement, and
//   also auto-rotates EXIF orientation. This shifts pixel values enough to break
//   the adaptive-threshold pipeline compared to the Python reference.
//
//   Stripping EXIF metadata isn't enough because the ICC profile (APP2 JPEG
//   marker) remains in the file and still triggers browser canvas color management.
//
//   createImageBitmap(blob, { colorSpaceConversion: 'none', imageOrientation: 'none' })
//   decodes the raw image data exactly as stored in the file, matching OpenCV's
//   behavior. The result is drawn onto a canvas so OpenCV.js can consume it.
//
// Falls back to null on error — caller uses the original HTMLImageElement instead.
export async function loadImageRaw(
	src: HTMLImageElement
): Promise<HTMLCanvasElement | null> {
	try {
		const response = await fetch(src.src);
		const blob = await response.blob();
		const bitmap = await createImageBitmap(blob, {
			colorSpaceConversion: 'none',
			imageOrientation: 'none'
		});
		const canvas = document.createElement('canvas');
		canvas.width = bitmap.width;
		canvas.height = bitmap.height;
		const ctx = canvas.getContext('2d')!;
		ctx.drawImage(bitmap, 0, 0);
		bitmap.close();
		return canvas;
	} catch {
		return null;
	}
}
