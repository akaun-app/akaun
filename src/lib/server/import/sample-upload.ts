/**
 * The sample spreadsheet the import profile editor sends, checked as an
 * upload is (006 FR-050): its name, its size and what its bytes are. Both the
 * look at a sample (`/api/import/profiles/sample`) and the preview of a
 * profile reading it (`/api/import/profiles/preview`) take one, and neither
 * stores it: the bytes are read from the request and dropped.
 */

import { MAX_UPLOAD_BYTES } from "$lib/server/file-storage.js";
import {
  importUploadNameRefusal,
  sniffImportUpload,
} from "$lib/server/import/upload-type.js";

/** A sample's bytes and type, or why it is refused, with the HTTP status. */
export type SampleUpload =
  | { ok: true; bytes: Uint8Array; type: "xlsx" | "csv" }
  | { ok: false; status: number; error: string };

/** Reads and checks the form's `file` field. */
export async function readSampleUpload(
  form: FormData,
  refusedType: string,
): Promise<SampleUpload> {
  const file = form.get("file");
  if (!(file instanceof File)) {
    return { ok: false, status: 400, error: "Choose a sample spreadsheet." };
  }
  const nameRefusal = importUploadNameRefusal(file.name);
  if (nameRefusal) return { ok: false, status: 400, error: nameRefusal };
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      status: 413,
      error: `File too large. Maximum size is ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))} MB.`,
    };
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const sniffed = sniffImportUpload(buffer, file.name);
  if (!sniffed.ok) return { ok: false, status: 400, error: sniffed.error };
  if (sniffed.type !== "xlsx" && sniffed.type !== "csv") {
    return { ok: false, status: 400, error: refusedType };
  }
  return { ok: true, bytes: new Uint8Array(buffer), type: sniffed.type };
}
