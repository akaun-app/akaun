import { describe, expect, it } from "vitest";
import { resolveMovementLabel } from "./movement-label.js";

describe("resolveMovementLabel", () => {
  it("Labeled_ShouldUseTheMovementsOwnLabel", () => {
    expect(resolveMovementLabel("Scissors", "Scissors and paper")).toBe(
      "Scissors",
    );
  });

  it("Unlabeled_ShouldFallBackToTheRecordDescription", () => {
    expect(resolveMovementLabel(null, "Scissors and paper")).toBe(
      "Scissors and paper",
    );
  });
});
