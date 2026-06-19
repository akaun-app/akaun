import { readFileSync } from 'fs';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import { createWorker } from 'tesseract.js';

GlobalWorkerOptions.workerSrc = import.meta.resolve('pdfjs-dist/build/pdf.worker.mjs');

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
	const doc = await getDocument({ data: new Uint8Array(buffer) }).promise;
	const total = doc.numPages;
	const pages: string[] = [];

	for (let i = 1; i <= total; i++) {
		const page = await doc.getPage(i);
		const content = await page.getTextContent();
		const pageText = content.items
			.filter((item): item is { str: string; hasEOL: boolean } => 'str' in item)
			.map((item) => item.str + (item.hasEOL ? '\n' : ' '))
			.join('');
		pages.push(pageText);
	}

	await doc.destroy();

	const text = pages.join('\n').trim();
	const avgCharsPerPage = total > 0 ? text.length / total : text.length;

	if (avgCharsPerPage < 50 && text.length < 200) {
		// Scanned PDF — fall back to OCR
		return extractFromImage(absPath);
	}
	return text;
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
