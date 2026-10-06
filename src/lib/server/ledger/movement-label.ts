/**
 * What one movement is called on screen: its own label, or the record's
 * description when it has none.
 *
 * This is the one place that rule runs. `label` is stored per movement so a
 * split line can say what it was for ("Scissors") when the record's own
 * description ("Scissors and paper") does not tell two lines apart — but
 * every movement still needs *something* to show, so a blank line falls back
 * to the one thing every record already has. Resolved once here rather than
 * left for each screen to remember: `queries/ledger.ts`'s `toRecordView`
 * computes `MovementView.displayLabel` from this on every read, so a
 * consumer of `RecordView.movements` never needs its own copy of the `??`.
 */
export function resolveMovementLabel(
  label: string | null,
  description: string,
): string {
  return label ?? description;
}
