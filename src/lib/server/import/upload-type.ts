/**
 * What Auto Import accepts as an upload (006 FR-050): a PDF, a JPG or PNG
 * photo, an Excel workbook (`.xlsx`) or a CSV file.
 *
 * Only Auto Import takes spreadsheets. Reconciliation and record attachments
 * keep `sniffAllowedType`, which is not widened, so they still refuse them.
 *
 * Every check is on the file's content as well as its name, because the name
 * is the client's to choose. The name still matters for a spreadsheet: a
 * document is read by its name (`inferMimeType`), so a `.csv` that holds a
 * workbook, or an `.xlsx` that holds text, is refused here rather than failing
 * later with a reason that makes no sense. For a PDF or a photo the check is
 * exactly the one it has always been (FR-004).
 */

import { sniffAllowedType } from "../file-storage.js";
import { looksLikeZip } from "../extraction/spreadsheet/zip.js";
import { workbookRefusal } from "../extraction/spreadsheet/xlsx.js";

export type ImportUploadType = "pdf" | "jpeg" | "png" | "xlsx" | "csv";

export type ImportUploadCheck =
  | { ok: true; type: ImportUploadType }
  | { ok: false; error: string };

const ACCEPTED_NAME = /\.(pdf|jpe?g|png|xlsx|csv)$/i;

const UNSUPPORTED_NAME =
  "Unsupported file type. Upload a PDF, JPG, PNG, Excel workbook (.xlsx) or CSV file.";

const OLD_EXCEL_NAME =
  "This is an old Excel file (.xls), which cannot be read. Open it in Excel, save it as .xlsx or .csv and upload it again.";

const BINARY_EXCEL_NAME =
  "This is a binary Excel workbook (.xlsb), which cannot be read. Open it in Excel, save it as .xlsx or .csv and upload it again.";

/** The message a PDF or a photo has always been refused with. */
const NOT_PDF_OR_IMAGE = "File content is not a valid PDF, JPG, or PNG.";

const COMPOUND_FILE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/** The file name's extension, in lower case, without the dot. */
function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot + 1).toLowerCase();
}

/**
 * Why a file with this name is refused before its content is looked at, or
 * null when the name is one Auto Import reads. An old `.xls` or a binary
 * `.xlsb` workbook is named, with what to do, rather than called unsupported.
 */
export function importUploadNameRefusal(filename: string): string | null {
  if (ACCEPTED_NAME.test(filename)) return null;
  const extension = extensionOf(filename);
  if (extension === "xls") return OLD_EXCEL_NAME;
  if (extension === "xlsb") return BINARY_EXCEL_NAME;
  return UNSUPPORTED_NAME;
}

/**
 * What the upload is, by its content and its name together, or why it is
 * refused. Call it after `importUploadNameRefusal` has passed the name.
 */
export function sniffImportUpload(
  buffer: Buffer,
  filename: string,
): ImportUploadCheck {
  const extension = extensionOf(filename);
  if (extension === "xlsx") {
    const refusal = workbookRefusal(buffer);
    return refusal ? { ok: false, error: refusal } : { ok: true, type: "xlsx" };
  }
  if (extension === "csv") {
    const refusal = csvRefusal(buffer);
    return refusal ? { ok: false, error: refusal } : { ok: true, type: "csv" };
  }
  const type = sniffAllowedType(buffer);
  return type ? { ok: true, type } : { ok: false, error: NOT_PDF_OR_IMAGE };
}

/**
 * Why a `.csv` upload is not a CSV file, or null. A CSV file has no magic
 * bytes, so what is checked is that it is text: not a PDF, a photo or an
 * Office file, and with no zero bytes, which text never holds. UTF-16 text
 * does hold them, so it is let through when it starts with its byte order
 * mark, which is how the CSV reader knows it is UTF-16.
 */
function csvRefusal(buffer: Buffer): string | null {
  if (buffer.length === 0) return "The CSV file is empty.";
  if (COMPOUND_FILE_MAGIC.every((byte, i) => buffer[i] === byte)) {
    // An old .xls or a password-protected workbook. Renaming either to .xlsx
    // would only bring this same reason at the next upload, so give it now.
    return `The file is named .csv but is not a CSV file. ${workbookRefusal(buffer)}`;
  }
  if (looksLikeZip(buffer)) {
    return "The file is named .csv but is an Excel workbook. Rename it to .xlsx, or save it from Excel as CSV, and upload it again.";
  }
  if (sniffAllowedType(buffer) !== null) {
    return "The file is named .csv but is a PDF or an image, not a CSV file.";
  }
  const utf16 =
    (buffer[0] === 0xff && buffer[1] === 0xfe) ||
    (buffer[0] === 0xfe && buffer[1] === 0xff);
  if (!utf16 && buffer.includes(0)) {
    return "The file is named .csv but does not hold text, so it is not a CSV file.";
  }
  return null;
}
