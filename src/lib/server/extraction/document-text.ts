import { readFileSync, mkdirSync } from 'fs';
import { extractText as pdfExtractText, getDocumentProxy, extractImages } from 'unpdf';
import { createWorker } from 'tesseract.js';
import { PNG } from 'pngjs';
import { OCR_CACHE_PATH } from '../env.js';

const OCR_LANGS = 'eng+chi_sim';

/**
 * Creates a tesseract worker with an explicit cache dir. Without `cachePath`
 * tesseract.js downloads its `*.traineddata` files into the process CWD.
 */
async function createOcrWorker() {
	mkdirSync(OCR_CACHE_PATH, { recursive: true });
	return createWorker(OCR_LANGS, undefined, { cachePath: OCR_CACHE_PATH });
}

/** Infers the MIME type this module's extractors understand from a filename's extension. */
export function inferMimeType(filename: string): string {
	const lower = filename.toLowerCase();
	if (lower.endsWith('.pdf')) return 'application/pdf';
	if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
	if (lower.endsWith('.png')) return 'image/png';
	return 'application/octet-stream';
}

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
	const pages = await ocrScannedPdfPages(buffer, totalPages);
	return pages.flat().join('\n').trim();
}

// OCRs every image of a scanned PDF (one with no text layer), since
// tesseract.js can't read PDF bytes directly. Returns, for each page, the text
// of each of its images in order.
async function ocrScannedPdfPages(buffer: Buffer, totalPages: number): Promise<string[][]> {
	const pdf = await getDocumentProxy(new Uint8Array(buffer));
	const worker = await createOcrWorker();
	try {
		const pages: string[][] = [];
		for (let pageNumber = 1; pageNumber <= totalPages; pageNumber++) {
			const images = await extractImages(pdf, pageNumber);
			const texts: string[] = [];
			for (const img of images) {
				const png = imageObjectToPngBuffer(img.data, img.width, img.height, img.channels);
				const { data } = await worker.recognize(png);
				texts.push(data.text.trim());
			}
			pages.push(texts);
		}
		return pages;
	} finally {
		await worker.terminate();
	}
}

async function extractFromImage(absPath: string): Promise<string> {
	const worker = await createOcrWorker();
	try {
		const { data } = await worker.recognize(absPath);
		return data.text.trim();
	} finally {
		await worker.terminate();
	}
}

// ── Numbered text, for reading a document line by line ─────────────────────
//
// The receipt reading above sends the text as one run with no line breaks,
// which is enough to find one total (006 FR-004 keeps it that way). A reading
// that proposes one record per line needs the lines themselves, so this path
// keeps each page's line breaks and numbers every line. The model then says
// which line each item came from (`source_line`), and the reviewer can find it.

/** Marks the start of a page in numbered text. */
export function pageMarker(pageNumber: number): string {
	return `--- page ${pageNumber} ---`;
}

/**
 * Joins a document's pages into numbered text: each page starts with its
 * marker line, and every line with text on it starts with its number, for
 * example `L0001│Service fee 10.00`. Numbers run on across pages, so a number
 * names one line of the whole document. Blank lines are left out and not
 * numbered. Nothing is cut: every line of every page is kept.
 */
export function numberDocumentLines(pages: readonly string[]): string {
	const out: string[] = [];
	let lineNumber = 0;
	pages.forEach((page, index) => {
		out.push(pageMarker(index + 1));
		for (const line of page.split(/\r\n|\r|\n/)) {
			const text = line.trimEnd();
			if (!text.trim()) continue;
			lineNumber++;
			out.push(`L${String(lineNumber).padStart(4, '0')}│${text}`);
		}
	});
	return out.join('\n');
}

/**
 * Numbered text back as plain text: the page markers dropped and each line's
 * number taken off, so what is left is only what the document prints. Used
 * where the text is kept to be searched, where "L0001" would be noise.
 */
export function stripLineNumbers(numbered: string): string {
	const markers = /^--- page \d+ ---$/;
	return numbered
		.split('\n')
		.filter((line) => !markers.test(line))
		.map((line) => line.replace(/^L\d+│/, ''))
		.join('\n');
}

/**
 * The document's text with its line breaks kept and every line numbered (see
 * `numberDocumentLines`), for the several-items reading. A text PDF is read a
 * page at a time; a scanned PDF and an image are read by OCR, and numbered the
 * same way.
 */
export async function extractNumberedText(absPath: string, mimeType: string): Promise<string> {
	return numberDocumentLines(await extractPages(absPath, mimeType));
}

async function extractPages(absPath: string, mimeType: string): Promise<string[]> {
	if (mimeType === 'application/pdf' || absPath.toLowerCase().endsWith('.pdf')) {
		const buffer = readFileSync(absPath);
		const { text: pages, totalPages } = await pdfExtractText(new Uint8Array(buffer), {
			mergePages: false
		});
		// The same test as the receipt path for a PDF with no text layer.
		const length = pages.reduce((sum, page) => sum + page.length, 0);
		const avgCharsPerPage = totalPages > 0 ? length / totalPages : length;
		if (avgCharsPerPage < 50 && length < 200) {
			const ocr = await ocrScannedPdfPages(buffer, totalPages);
			return ocr.map((texts) => texts.join('\n'));
		}
		return pages;
	}
	if (
		mimeType === 'image/jpeg' ||
		mimeType === 'image/png' ||
		/\.(jpe?g|png)$/i.test(absPath)
	) {
		return [await extractFromImage(absPath)];
	}
	throw new Error(`Unsupported file type. Please upload a PDF, JPG, or PNG.`);
}
