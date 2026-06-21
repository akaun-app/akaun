import { jsPDF } from 'jspdf';
import type { FinishedPage } from './page-types';

// Keeps the page's own aspect ratio (ported from the POC's downloadPDF)
// rather than forcing it onto a fixed page size like A4.
function pageSize(width: number, height: number): { pw: number; ph: number } {
	const ratio = width / height;
	if (ratio > 0.707) {
		const pw = 595.28;
		return { pw, ph: pw / ratio };
	}
	const ph = 841.89;
	return { pw: ph * ratio, ph };
}

export async function assemblePdf(page: FinishedPage): Promise<File> {
	const { pw, ph } = pageSize(page.width, page.height);
	const orientation = page.width / page.height > 1 ? 'landscape' : 'portrait';

	const pdf = new jsPDF({ orientation, unit: 'pt', format: [pw, ph] });
	pdf.addImage(page.dataUrl, 'JPEG', 0, 0, pw, ph);

	const blob = pdf.output('blob');
	return new File([blob], `scan-${Date.now()}.pdf`, { type: 'application/pdf' });
}
