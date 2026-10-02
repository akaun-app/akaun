import { describe, expect, it } from "vitest";
import {
  blankForm,
  errorsAt,
  errorsUnder,
  formFingerprint,
  formFromDraft,
  newFeeType,
  newSection,
  payloadFromForm,
  sectionKeys,
  slugifyKey,
  typingKey,
} from "./import-profile-form.js";
import { checkProfile } from "./import-profile-schema.js";
import {
  IMPORT_PROFILE_STARTERS,
  starterDraft,
} from "./import-profile-starters.js";

/**
 * The import profile editor's form (006 US6, FR-030, FR-035). The editor
 * stages this shape and sends `payloadFromForm` once; the shared check reads
 * that payload on both sides, so each test here ends in that check.
 */

describe("keys made from names", () => {
  it("turns a name into a plain key", () => {
    expect(slugifyKey("Ads & promotions")).toBe("ads_promotions");
    expect(slugifyKey("  Café fees ")).toBe("cafe_fees");
    expect(slugifyKey("2024 Fees")).toBe("fees");
  });

  it("gives nothing for a name with no usable letter", () => {
    expect(slugifyKey("1234")).toBe("");
    expect(slugifyKey("手数料")).toBe("");
  });

  it("keeps a key within 32 characters", () => {
    const key = slugifyKey("a very long section name that goes on and on");
    expect(key.length).toBeLessThanOrEqual(32);
    expect(key.endsWith("_")).toBe(false);
  });

  it("cleans a fee type key as it is typed, keeping a trailing _", () => {
    expect(typingKey("Commission Fee")).toBe("commission_fee");
    expect(typingKey("ads-")).toBe("ads_");
    expect(typingKey("tax (6%)")).toBe("tax_6");
  });
});

describe("section keys", () => {
  it("makes a new section's key from its name", () => {
    const section = { ...newSection(), name: "Platform fees" };
    expect(sectionKeys([section])).toEqual(["platform_fees"]);
  });

  it("keeps a saved section's key when it is renamed", () => {
    const form = formFromDraft(starterDraft("fee_document")!);
    form.sections[0].name = "Charges";
    expect(sectionKeys(form.sections)).toEqual(["fees"]);
  });

  it("numbers a new section whose name another section already uses", () => {
    const saved = formFromDraft(starterDraft("fee_document")!).sections[0];
    const again = { ...newSection(), name: "Fees" };
    const third = { ...newSection(), name: "Fees" };
    expect(sectionKeys([saved, again, third])).toEqual([
      "fees",
      "fees_2",
      "fees_3",
    ]);
  });

  it("names a section with no usable letter by its place", () => {
    const sections = [newSection(), { ...newSection(), name: "123" }];
    expect(sectionKeys(sections)).toEqual(["section_1", "section_2"]);
  });
});

describe("the form and the profile", () => {
  it.each(IMPORT_PROFILE_STARTERS.map((starter) => [starter.id]))(
    "%s comes back unchanged through the form",
    (id) => {
      const draft = starterDraft(id)!;
      const result = checkProfile(payloadFromForm(formFromDraft(draft)));
      expect(result).toEqual({ ok: true, profile: draft });
    },
  );

  it("keeps a transfer section's accounts through the form (FR-058)", () => {
    const draft = starterDraft(IMPORT_PROFILE_STARTERS[0].id)!;
    const transfer = {
      ...draft,
      accountId: 7,
      sections: [
        ...draft.sections,
        {
          key: "withdrawals",
          name: "Withdrawals",
          description: "Each withdrawal to the bank.",
          mode: "summary" as const,
          kind: "transfer" as const,
          fixedCategoryAccountId: null,
          feeTypes: [],
          extras: null,
          counterAccountId: 8,
        },
      ],
    };
    const form = formFromDraft(transfer);
    expect(form.accountId).toBe(7);
    expect(checkProfile(payloadFromForm(form))).toEqual({
      ok: true,
      profile: transfer,
    });

    // Another kind sends no other account, even when one was left behind.
    const last = form.sections[form.sections.length - 1];
    last.kind = "expense";
    const payload = payloadFromForm(form) as {
      sections: Record<string, unknown>[];
    };
    expect(payload.sections.at(-1)).not.toHaveProperty("counterAccountId");
  });

  it("starts a new section in Summary, and sends each section's own mode", () => {
    const form = blankForm();
    form.sections.push(newSection("every_transaction"));
    const payload = payloadFromForm(form) as {
      sections: { mode: string }[];
    };
    expect(payload.sections.map((section) => section.mode)).toEqual([
      "summary",
      "every_transaction",
    ]);
  });

  it("sends no stated total when the label is empty", () => {
    const form = blankForm();
    form.statedTotals.summary = "   ";
    expect(payloadFromForm(form).statedTotalLabels).toEqual({});
    form.statedTotals.summary = "Total charges";
    expect(payloadFromForm(form).statedTotalLabels).toEqual({
      summary: "Total charges",
    });
  });

  it("keeps each mode's sections and stated total through the form", () => {
    const draft = starterDraft("marketplace_summary")!;
    draft.sections[1] = { ...draft.sections[1], mode: "every_transaction" };
    draft.statedTotalLabels = {
      summary: "Total payout released",
      every_transaction: " Total money in ",
    };
    const result = checkProfile(payloadFromForm(formFromDraft(draft)));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile.sections.map((section) => section.mode)).toEqual([
      "summary",
      "every_transaction",
    ]);
    expect(result.profile.statedTotalLabels).toEqual({
      summary: "Total payout released",
      every_transaction: "Total money in",
    });
  });

  it("sends the extra fields as typed, and the check reads them", () => {
    const form = formFromDraft(starterDraft("fee_document")!);
    form.sections[0].extrasText =
      '{"type":"object","properties":{"order_no":{"type":["string","null"]}}}';
    const result = checkProfile(payloadFromForm(form));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile.sections[0].extras).toEqual({
      type: "object",
      properties: { order_no: { type: ["string", "null"] } },
    });
  });

  it("shows saved extra fields as JSON text, and none as empty", () => {
    const draft = starterDraft("fee_document")!;
    draft.sections[0].extras = {
      type: "object",
      properties: { order_no: { type: "string" } },
    };
    const form = formFromDraft(draft);
    expect(JSON.parse(form.sections[0].extrasText)).toEqual(
      draft.sections[0].extras,
    );
    expect(formFromDraft(starterDraft("fee_document")!).sections[0]).toEqual(
      expect.objectContaining({ extrasText: "" }),
    );
  });

  it("refuses a blank profile with the fields to fill in", () => {
    const result = checkProfile(payloadFromForm(blankForm()));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((error) => error.path)).toEqual(
      expect.arrayContaining([
        "name",
        "description",
        "sections[0].name",
        "sections[0].description",
      ]),
    );
  });
});

describe("unsaved changes", () => {
  it("is the same for the same form, whatever the row ids", () => {
    const draft = starterDraft("marketplace_summary")!;
    expect(formFingerprint(formFromDraft(draft))).toBe(
      formFingerprint(formFromDraft(draft)),
    );
  });

  it("changes when a fee type is added or a category pinned", () => {
    const form = formFromDraft(starterDraft("fee_document")!);
    const before = formFingerprint(form);
    form.sections[0].feeTypes.push(newFeeType());
    const added = formFingerprint(form);
    expect(added).not.toBe(before);
    form.sections[0].feeTypes[0].categoryAccountId = 12;
    expect(formFingerprint(form)).not.toBe(added);
  });
});

describe("where a problem is shown", () => {
  const errors = [
    { path: "name", message: "Fill in the name." },
    {
      path: "sections[0].extras.properties.order_no.type",
      message: "Bad type.",
    },
    { path: "sections[0].extras", message: "Not JSON." },
    { path: "sections[10].name", message: "Other section." },
  ];

  it("finds the problems of one field", () => {
    expect(errorsAt(errors, "name")).toEqual(["Fill in the name."]);
    expect(errorsAt(errors, "description")).toEqual([]);
  });

  it("finds every problem under the extra fields, with the rest of the path", () => {
    expect(errorsUnder(errors, "sections[0].extras")).toEqual([
      "properties.order_no.type: Bad type.",
      "Not JSON.",
    ]);
    expect(errorsUnder(errors, "sections[1]")).toEqual([]);
  });
});
