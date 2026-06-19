import { readFileSync } from 'fs';
import { extractText as pdfExtractText } from 'unpdf';
import { createWorker } from 'tesseract.js';

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
		// Scanned PDF — fall back to OCR
		return extractFromImage(absPath);
	}
	return text.trim();
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
