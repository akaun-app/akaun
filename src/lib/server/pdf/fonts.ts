import {
  INTER_REGULAR_TTF_BASE64,
  INTER_SEMIBOLD_TTF_BASE64,
} from "./inter-font-data.js";

export type Fonts = { regular: string; bold: string };

/**
 * Registers Inter on a PDFDocument instance and returns the font names to
 * use. Inter is the only PDF template font — it's embedded from vendored TTF
 * data so PDF generation never depends on a filesystem path a bundler or
 * packaged build might not preserve. "Bold" is Inter SemiBold (600), not
 * true Bold (700): full weight read as too heavy against the rest of the
 * document.
 */
export function registerPdfFonts(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  doc: any,
): Fonts {
  doc.registerFont("Inter", Buffer.from(INTER_REGULAR_TTF_BASE64, "base64"));
  doc.registerFont(
    "Inter-SemiBold",
    Buffer.from(INTER_SEMIBOLD_TTF_BASE64, "base64"),
  );
  return { regular: "Inter", bold: "Inter-SemiBold" };
}
