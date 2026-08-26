import type { Minor } from "./types.js";

/**
 * Turning what a user typed into whole cents, and splitting a payment across
 * what it covers without losing or inventing a cent.
 *
 * Pure arithmetic — no database, no rounding policy hidden anywhere else. Every
 * conversion in the ledger goes through `toMinor`, so "the two sides cancel out
 * exactly" is a property of one function rather than a hope.
 */

/**
 * Binary floating point cannot hold most decimal amounts exactly: `1.005 * 100`
 * is 100.49999999999999, which `Math.round` would take *down* to 100. Rounding
 * the value to twelve significant digits first discards that representation
 * error while keeping every digit a money amount can actually carry, so the tie
 * lands where a person reading "1.005" expects it to.
 */
const SIGNIFICANT_DIGITS = 12;

/**
 * The record's entered figure at its own stored rate, in whole cents of the
 * main currency. Halves round away from zero, the way a person totals a column
 * by hand (FR-005).
 */
export function toMinor(amount: number, exchangeRate: number): Minor {
  const scaled = amount * exchangeRate * 100;
  if (!Number.isFinite(scaled)) return 0;
  const clean = Number(scaled.toPrecision(SIGNIFICANT_DIGITS));
  return Math.sign(clean) * Math.round(Math.abs(clean));
}

/** Cents back to a decimal. For display only — never sum these. */
export function fromMinor(minor: Minor): number {
  return Number((minor / 100).toFixed(2));
}

/**
 * What is left for the one category a caller already knows about, once every
 * other typed category (`extraAmounts`, each a signed movement) has taken its
 * own share of `total`. Whether zero-or-less is worth refusing, and in what
 * words, is the caller's — this only does the arithmetic (data-model.md
 * invariant 6: a record's movements must add up to its own figure).
 */
export function remainderMinor(total: Minor, extraAmounts: Minor[]): Minor {
  const extraTotal = extraAmounts.reduce((sum, m) => sum + Math.abs(m), 0);
  return total - extraTotal;
}

/**
 * Splits `total` in proportion to `weights` so the parts sum to exactly
 * `total`. Whole division rarely comes out even in cents, so the remainder is
 * handed out one cent at a time to the largest weights first — the largest
 * share absorbs the rounding, which is what a person doing it by hand does.
 *
 * A zero weight is always given zero, even when cents are left over, so an item
 * that is owed nothing is never credited with a payment.
 */
export function allocateMinor(total: Minor, weights: Minor[]): Minor[] {
  if (weights.length === 0) return [];
  if (weights.length === 1) return [total];

  const magnitudes = weights.map((w) => Math.abs(w));
  const weightTotal = magnitudes.reduce((sum, w) => sum + w, 0);
  if (weightTotal === 0) return weights.map(() => 0);

  const parts = magnitudes.map((w) => Math.trunc((total * w) / weightTotal));
  let remainder = total - parts.reduce((sum, p) => sum + p, 0);

  // Largest weight first, and ties by original position, so the same inputs
  // always split the same way.
  const order = magnitudes
    .map((w, i) => ({ w, i }))
    .sort((a, b) => b.w - a.w || a.i - b.i);

  const step = Math.sign(remainder);
  for (const { w, i } of order) {
    if (remainder === 0) break;
    if (w === 0) continue;
    parts[i] += step;
    remainder -= step;
  }

  return parts;
}
