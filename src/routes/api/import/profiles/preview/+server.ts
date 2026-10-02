import { json } from "@sveltejs/kit";
import { forbidden } from "$lib/server/api-response.js";
import { mainCurrencyCode } from "$lib/server/currency/form.js";
import { db } from "$lib/server/db/client.js";
import { MAX_UPLOAD_BYTES } from "$lib/server/file-storage.js";
import { previewTable } from "$lib/server/import/table-preview.js";
import {
  importUploadNameRefusal,
  sniffImportUpload,
} from "$lib/server/import/upload-type.js";
import { hasPermission } from "$lib/server/permissions.js";
import type { RequestHandler } from "./$types.js";

/**
 * A preview of how the profile being edited reads a sample spreadsheet from
 * its columns (006 FR-053 to FR-055): the headings found, the first rows as
 * items, the count of each section and any reason the reading would fail.
 *
 * It is part of editing a profile, so it needs `import.change`, as saving one
 * does (FR-045). It **stores nothing**: the sample is read from the request
 * and dropped, the profile is never saved, and no queue row, file or audit
 * entry is made. The only read of the database is the main currency, which
 * an amount written in another currency's code is checked against, as an
 * upload is.
 *
 * The body is a form: `file` (an `.xlsx` or `.csv`), `profile` (the editor's
 * payload, as JSON) and optionally `mode` (Summary or Every transaction).
 */
export const POST: RequestHandler = async ({ locals, request }) => {
  if (!locals.user) return new Response("Unauthorized", { status: 401 });
  if (!hasPermission(locals, "import", "change")) return forbidden();

  const form = await request.formData().catch(() => null);
  if (!form)
    return json({ error: "Send the sample as a form." }, { status: 400 });
  const file = form.get("file");
  if (!(file instanceof File)) {
    return json({ error: "Choose a sample spreadsheet." }, { status: 400 });
  }
  let profile: unknown;
  try {
    profile = JSON.parse(String(form.get("profile") ?? ""));
  } catch {
    return json({ error: "The profile could not be read." }, { status: 400 });
  }

  const nameRefusal = importUploadNameRefusal(file.name);
  if (nameRefusal) return json({ error: nameRefusal }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) {
    return json(
      {
        error: `File too large. Maximum size is ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))} MB.`,
      },
      { status: 413 },
    );
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const sniffed = sniffImportUpload(buffer, file.name);
  if (!sniffed.ok) return json({ error: sniffed.error }, { status: 400 });
  if (sniffed.type !== "xlsx" && sniffed.type !== "csv") {
    return json(
      {
        error:
          "A preview reads a spreadsheet by its columns. Choose an Excel workbook (.xlsx) or a CSV file.",
      },
      { status: 400 },
    );
  }

  const result = previewTable(
    profile,
    { bytes: new Uint8Array(buffer), type: sniffed.type },
    {
      mode: form.get("mode"),
      mainCurrency: mainCurrencyCode(db),
      today: new Date().toISOString().slice(0, 10),
    },
  );
  if (!result.ok) {
    return json(
      {
        error: result.error,
        ...(result.errors ? { errors: result.errors } : {}),
      },
      { status: 422 },
    );
  }
  return json(result.preview);
};
