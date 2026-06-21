import { readFileSync } from 'fs';
import { extractText as pdfExtractText, getDocumentProxy, extractImages } from 'unpdf';
import { createWorker } from 'tesseract.js';
import { PNG } from 'pngjs';

export async function extractText(absPath: string, mimeType: string): Promise<string> {
	if (mimeType === 'application/pdf' || absPath.toLowerCase().endsWith('.pdf')) {
		return extractFromPdf(absPath);
	}
	if (
		mimeType === 'image/jpeg' ||
		mimeType === 'image/png' ||
		/\.(jpe?g|png)$/i.test(absPath)
	) {
		return extractFromImage(absPath);
	}
	throw new Error(`Unsupported file type. Please upload a PDF, JPG, or PNG.`);
}

async function extractFromPdf(absPath: string): Promise<string> {
	const buffer = readFileSync(absPath);
	const { text, totalPages } = await pdfExtractText(new Uint8Array(buffer), { mergePages: true });

	const avgCharsPerPage = totalPages > 0 ? text.length / totalPages : text.length;
	if (avgCharsPerPage < 50 && text.length < 200) {
		// Scanned PDF (no embedded text layer) — render each page to an image
		// and OCR that, since tesseract.js can't read PDF bytes directly.
		return extractFromScannedPdf(buffer, totalPages);
	}
	return text.trim();
}

// Encodes a decoded image's raw samples (1/3/4 channels) to a PNG buffer
// tesseract.js can read, expanding to RGBA. Uses pngjs (pure JS) instead of a
// native canvas so it runs on CPUs without AVX (e.g. low-power NAS hardware).
function imageObjectToPngBuffer(data: Uint8ClampedArray, width: number, height: number, channels: 1 | 3 | 4): Buffer {
	const png = new PNG({ width, height });
	const out = png.data; // RGBA Buffer, length width * height * 4
	for (let i = 0, p = 0; p < width * height; i += channels, p++) {
		const o = p * 4;
		if (channels === 1) {
			out[o] = out[o + 1] = out[o + 2] = data[i];
		} else {
			out[o] = data[i];
			out[o + 1] = data[i + 1];
			out[o + 2] = data[i + 2];
		}
		out[o + 3] = channels === 4 ? data[i + 3] : 255;
	}
	return PNG.sync.write(png);
}

async function extractFromScannedPdf(buffer: Buffer, totalPages: number): Promise<string> {
	const pdf = await getDocumentProxy(new Uint8Array(buffer));
	const worker = await createWorker('eng');
	try {
		const pageTexts: string[] = [];
		for (let pageNumber = 1; pageNumber <= totalPages; pageNumber++) {
			const images = await extractImages(pdf, pageNumber);
			for (const img of images) {
				const png = imageObjectToPngBuffer(img.data, img.width, img.height, img.channels);
				const { data } = await worker.recognize(png);
				pageTexts.push(data.text.trim());
			}
		}
		return pageTexts.join('\n').trim();
	} finally {
		await worker.terminate();
	}
}

async function extractFromImage(absPath: string): Promise<string> {
	const worker = await createWorker('eng');
	try {
		const { data } = await worker.recognize(absPath);
		return data.text.trim();
	} finally {
		await worker.terminate();
	}
}
