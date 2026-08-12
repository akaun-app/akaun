import { z } from "zod";
import { StatementDirection } from "$lib/enums.js";
import type { ParsedLine } from "./types.js";

const ExtractedStatementLineSchema = z
  .object({
    date: z
      .string()
      .trim()
      .min(1)
      .refine((value) => coerceDate(value) !== null),
    description: z.string().trim().min(1),
    amount: z.number().finite(),
    direction: z.enum(["in", "out"]).optional(),
    // Some providers reproduce the statement's running balance on every row.
    // It is deliberately accepted but never propagated to ParsedLine.
    balance: z.union([z.number(), z.string()]).optional(),
  })
  .strict();

export type ExtractedStatementLine = z.infer<
  typeof ExtractedStatementLineSchema
>;

/** A malformed transaction rejects the response so it cannot disappear silently. */
export const StatementLinesSchema = z
  .object({ lines: z.array(ExtractedStatementLineSchema) })
  .strict();

const SUMMARY_DESCRIPTION =
  /^(?:opening\s+balance|closing\s+balance|balance\s+(?:brought|carried)\s+forward|b\/f|c\/f|sub\s*total|total(?:\s+transactions?)?)(?:\b|\s|:|-)/i;

export function normaliseExtractedLines(raw: unknown): ParsedLine[] {
  const parsed = StatementLinesSchema.safeParse(raw);
  if (!parsed.success) return [];

  return parsed.data.lines.flatMap((line) => {
    const date = coerceDate(line.date);
    if (date === null || SUMMARY_DESCRIPTION.test(line.description)) return [];

    const amount = Math.abs(line.amount);
    if (!Number.isFinite(amount) || amount === 0) return [];

    return [
      {
        date,
        description: line.description.trim(),
        amount,
        direction:
          line.amount < 0
            ? StatementDirection.Out
            : normaliseDirection(line.direction),
      },
    ];
  });
}

function normaliseDirection(value: string | number | undefined) {
  if (value === StatementDirection.Out) return StatementDirection.Out;
  if (value === StatementDirection.In) return StatementDirection.In;

  const label = String(value ?? "")
    .trim()
    .toLowerCase();
  if (["out", "debit", "withdrawal", "dr"].includes(label)) {
    return StatementDirection.Out;
  }
  return StatementDirection.In;
}

function coerceDate(value: string): string | null {
  const text = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) return validIsoDate(iso[1], iso[2], iso[3]);

  // Statements in this product's locale conventionally print day first.
  const dayFirst = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(text);
  if (dayFirst) {
    return validIsoDate(
      dayFirst[3],
      dayFirst[2].padStart(2, "0"),
      dayFirst[1].padStart(2, "0"),
    );
  }

  // Parse textual dates at UTC noon so a positive local offset cannot move the
  // calendar day backwards when converted to ISO.
  const timestamp = Date.parse(`${text} 12:00:00 UTC`);
  if (Number.isNaN(timestamp)) return null;
  return new Date(timestamp).toISOString().slice(0, 10);
}

function validIsoDate(year: string, month: string, day: string): string | null {
  const candidate = `${year}-${month}-${day}`;
  const date = new Date(`${candidate}T00:00:00Z`);
  return date.toISOString().slice(0, 10) === candidate ? candidate : null;
}
