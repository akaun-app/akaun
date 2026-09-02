import { TemplateFont } from "$lib/enums.js";
import type { ThemeData } from "$lib/pdf/render-types.js";
import {
  INTER_REGULAR_TTF_BASE64,
  INTER_BOLD_TTF_BASE64,
} from "./inter-font-data.js";

export type Fonts = { regular: string; bold: string };

/**
 * Registers a theme's fonts on a PDFDocument instance and returns the font
 * names to use. PDFKit only ships Helvetica and Times-Roman natively, so
 * Inter is embedded from vendored TTF data; Roboto/Lato have no bundled
 * equivalent and fall back to Helvetica, the closest built-in match.
 */
export function fontsForTheme(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  doc: any,
  theme: ThemeData,
): Fonts {
  if (theme.font === TemplateFont.Merriweather) {
    return { regular: "Times-Roman", bold: "Times-Bold" };
  }
  if (theme.font === TemplateFont.Inter) {
    doc.registerFont("Inter", Buffer.from(INTER_REGULAR_TTF_BASE64, "base64"));
    doc.registerFont(
      "Inter-Bold",
      Buffer.from(INTER_BOLD_TTF_BASE64, "base64"),
    );
    return { regular: "Inter", bold: "Inter-Bold" };
  }
  return { regular: "Helvetica", bold: "Helvetica-Bold" };
}
