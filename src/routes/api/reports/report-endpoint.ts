import { z } from "zod";
import { isValidDate } from "$lib/server/date.js";
import { toCsv } from "$lib/server/ledger/reports/csv.js";
import type { CsvTable } from "$lib/server/ledger/types.js";

/**
 * The pieces the four report endpoints share: how a date arrives, and how a
 * report leaves.
 *
 * Every report answers the same request twice over — once as data for a screen
 * and once as a file for an accountant (FR-029) — so the branch is written here
 * rather than four times, and the column order stays wherever
 * `ledger/reports/csv.ts` put it.
 */

const isoDate = z
  .string()
  .refine(isValidDate, { message: "Give a date in the form 2026-01-31." });

/** Reports covering a period: both ends are required and both are included. */
export const periodQuery = z.object({ dateFrom: isoDate, dateTo: isoDate });

/** A report as at one date. */
export const asAtQuery = z.object({ asAt: isoDate });

export const accountHistoryQuery = z.object({
  accountId: z.coerce.number().int().positive(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
});

/** Reads a query string into the shape a schema expects, dropping what is absent. */
export function queryValues(
  url: URL,
  names: readonly string[],
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const name of names) {
    const value = url.searchParams.get(name);
    if (value !== null) values[name] = value;
  }
  return values;
}

export type ReportFormat = "json" | "csv";

export function formatFrom(url: URL): ReportFormat {
  return url.searchParams.get("format") === "csv" ? "csv" : "json";
}

/**
 * A spreadsheet on Windows reads a file without this marker as the machine's
 * own encoding, which turns every accented name and every en dash into
 * nonsense. It belongs here rather than in `toCsv`, which builds the document
 * itself and has no business knowing what will open it.
 */
const UTF8_BOM = "﻿";

export function reportResponse(
  format: ReportFormat,
  report: unknown,
  csvTable: () => CsvTable,
  filename: string,
): Response {
  if (format === "json") return Response.json(report);

  return new Response(UTF8_BOM + toCsv(csvTable()), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}.csv"`,
    },
  });
}
