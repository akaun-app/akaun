import { EPSILON, round2 } from "./types.js";
import type { AllocationInput } from "./types.js";

export function allocationTotal(
  allocations: readonly Pick<AllocationInput, "amount">[],
): number {
  return round2(
    allocations.reduce((sum, allocation) => sum + allocation.amount, 0),
  );
}

export function remainingAmount(total: number, allocated: number): number {
  return round2(total - allocated);
}

/** Amount selectable while editing a line: global remainder plus that line's saved allocation. */
export function availableForLine(
  globalRemaining: number,
  savedOnLine: number,
): number {
  return round2(globalRemaining + savedOnLine);
}

export function allocationState(
  total: number,
  allocated: number,
): "unmatched" | "partial" | "matched" | "overallocated" {
  if (allocated < EPSILON) return "unmatched";
  const remaining = remainingAmount(total, allocated);
  if (Math.abs(remaining) < EPSILON) return "matched";
  return remaining > 0 ? "partial" : "overallocated";
}

type SuggestionLine = { id: number; amount: number; score: number };
type SuggestionSet = { ids: number[]; score: number };

function betterSuggestion(
  left: SuggestionSet,
  right: SuggestionSet | undefined,
): boolean {
  if (!right) return true;
  if (left.ids.length !== right.ids.length)
    return left.ids.length < right.ids.length;
  if (left.score !== right.score) return left.score > right.score;
  return left.ids.join(":") < right.ids.join(":");
}

/**
 * Find a small exact-total statement-line set. The dynamic-programming state is
 * integer cents, avoiding float tolerance in a rule that can silently allocate
 * money. Fewer lines win, then the caller's relevance score, then stable IDs.
 */
export function suggestExactAllocationSet(
  target: number,
  input: readonly SuggestionLine[],
): number[] {
  const targetCents = Math.round(target * 100);
  if (targetCents <= 0) return [];
  const lines = input
    .filter((line) => line.amount > 0)
    .slice(0, 40)
    .sort((left, right) => left.id - right.id);
  const combinations = new Map<number, SuggestionSet>([
    [0, { ids: [], score: 0 }],
  ]);

  for (const line of lines) {
    const cents = Math.round(line.amount * 100);
    for (const [sum, combination] of [...combinations.entries()].sort(
      (a, b) => b[0] - a[0],
    )) {
      const next = sum + cents;
      if (next > targetCents || combination.ids.length >= 8) continue;
      const candidate = {
        ids: [...combination.ids, line.id],
        score: combination.score + line.score,
      };
      if (betterSuggestion(candidate, combinations.get(next)))
        combinations.set(next, candidate);
    }
  }

  return combinations.get(targetCents)?.ids ?? [];
}
