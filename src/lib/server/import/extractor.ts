import { readFileSync } from 'fs';
import { PDFParse } from 'pdf-parse';
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
	const parser = new PDFParse({ data: buffer });
	try {
		const result = await parser.getText();
		const text = result.text.trim();
		const avgCharsPerPage = result.total > 0 ? text.length / result.total : text.length;

		if (avgCharsPerPage < 50 && text.length < 200) {
			// Scanned PDF — fall back to OCR on the raw buffer treated as image
			return extractFromImage(absPath);
		}
		return text;
	} finally {
		await parser.destroy();
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
