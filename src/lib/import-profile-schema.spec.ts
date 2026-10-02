import { describe, expect, it } from "vitest";
import {
  PROFILE_ENUM_VALUES_MAX,
  PROFILE_EXTRAS_MAX,
  PROFILE_FEE_TYPES_MAX,
  PROFILE_SECTIONS_MAX,
  checkProfile,
  extraFieldsOf,
  foldTableText,
  formatProfileErrors,
  readsFromColumns,
  validateExtrasFragment,
  validateProfile,
  type ImportProfileDraft,
  type ProfileError,
} from "./import-profile-schema.js";
import {
  orderSections,
  walletLayout,
  withdrawalSection,
} from "./server/import/__fixtures__/wallet-table.js";
import {
  IMPORT_PROFILE_STARTERS,
  starterDraft,
} from "./import-profile-starters.js";

/**
 * The one check of an import profile, which the editor and the server both
 * run (006 FR-035). Each rule is shown refusing with the path of the value it
 * is about, so the editor can put the message beside the field.
 */

function profile(): ImportProfileDraft {
  return {
    name: "Ads invoice",
    description: "A monthly advertising invoice.",
    phrases: ["Ads e-Invoice"],
    instructions: "- Read each ad charge.",
    statedTotalLabels: { summary: "Total charges" },
    sections: [
      {
        key: "fees",
        name: "Fees",
        description: "Each ad charge line.",
        mode: "summary",
        kind: "expense",
        fixedCategoryAccountId: null,
        feeTypes: [
          { key: "ads", description: "Ads", categoryAccountId: 7 },
          { key: "tax", description: "", categoryAccountId: null },
        ],
        extras: null,
      },
    ],
  };
}

function withExtras(extras: unknown) {
  const value = profile() as unknown as {
    sections: Record<string, unknown>[];
  };
  value.sections[0].extras = extras;
  return value;
}

function paths(errors: ProfileError[]): string[] {
  return errors.map((error) => error.path);
}

describe("starters", () => {
  it.each(IMPORT_PROFILE_STARTERS.map((starter) => [starter.id, starter]))(
    "%s passes the check unchanged",
    (_id, starter) => {
      const result = checkProfile(starter.draft);
      expect(result).toEqual({ ok: true, profile: starter.draft });
    },
  );

  it("mirrors the marketplace summary: 15 leaf lines over two sections", () => {
    const draft = starterDraft("marketplace_summary")!;
    expect(
      draft.sections.map((section) => [section.key, section.kind]),
    ).toEqual([
      ["sales", "income"],
      ["fees", "by_sign"],
    ]);
    const keys = draft.sections.flatMap((section) =>
      section.feeTypes.map((feeType) => feeType.key),
    );
    expect(keys).toHaveLength(15);
    expect(draft.instructions).toMatch(/never list a subtotal/i);
  });

  it("gives a fresh copy each time, so the editor never changes the starter", () => {
    const copy = starterDraft("fee_document")!;
    copy.sections[0].feeTypes.pop();
    expect(starterDraft("fee_document")!.sections[0].feeTypes).toHaveLength(5);
    expect(starterDraft("nothing")).toBeNull();
  });

  it("puts every section in Summary, the only mode there is", () => {
    for (const starter of IMPORT_PROFILE_STARTERS) {
      for (const section of starter.draft.sections) {
        expect(section.mode).toBe("summary");
      }
      expect(Object.keys(starter.draft.statedTotalLabels)).toEqual(["summary"]);
    }
  });
});

describe("checkProfile", () => {
  it("accepts a valid profile and trims its text", () => {
    const input = profile();
    input.name = "  Ads invoice  ";
    input.sections[0].feeTypes[0].description = " Ads ";
    const result = checkProfile(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile.name).toBe("Ads invoice");
    expect(result.profile.sections[0].feeTypes[0].description).toBe("Ads");
  });

  it("drops keys a profile does not have", () => {
    const result = checkProfile({ ...profile(), id: 3, enabled: false });
    expect(result.ok && Object.keys(result.profile).sort()).toEqual([
      "description",
      "instructions",
      "name",
      "phrases",
      "sections",
      "statedTotalLabels",
    ]);
  });

  it("reads a section with no mode as Summary", () => {
    const input = profile() as unknown as {
      sections: Record<string, unknown>[];
    };
    delete input.sections[0].mode;
    const result = checkProfile(input);
    expect(result.ok && result.profile.sections[0].mode).toBe("summary");
  });

  it("keeps each section's own mode, Every transaction included", () => {
    const input = profile();
    input.sections.push({
      ...input.sections[0],
      key: "rows",
      name: "Transactions",
      mode: "every_transaction",
    });
    const result = checkProfile(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile.sections.map((section) => section.mode)).toEqual([
      "summary",
      "every_transaction",
    ]);
  });

  it("keeps a stated total per mode", () => {
    const input = profile();
    input.statedTotalLabels = {
      summary: "Total charges",
      every_transaction: "  Total money in  ",
    };
    const result = checkProfile(input);
    expect(result.ok && result.profile.statedTotalLabels).toEqual({
      summary: "Total charges",
      every_transaction: "Total money in",
    });
  });

  it("refuses a mode or a stated-total mode it does not know", () => {
    const input = profile() as unknown as {
      sections: Record<string, unknown>[];
      statedTotalLabels: Record<string, string>;
    };
    input.sections[0].mode = "everything";
    input.statedTotalLabels.everything = "Total";
    const errors = validateProfile(input);
    expect(paths(errors)).toEqual([
      "statedTotalLabels.everything",
      "sections[0].mode",
    ]);
    expect(errors[1].message).toBe(
      "Choose whether the section is read in Summary or Every transaction.",
    );
  });

  it("names each missing required field", () => {
    const input = profile();
    input.name = " ";
    input.description = "";
    input.sections[0].name = "";
    input.sections[0].description = "";
    expect(paths(validateProfile(input))).toEqual([
      "name",
      "description",
      "sections[0].name",
      "sections[0].description",
    ]);
  });

  it("needs at least one section", () => {
    const input = profile();
    input.sections = [];
    expect(validateProfile(input)).toEqual([
      { path: "sections", message: "A profile needs at least one section." },
    ]);
  });

  it("refuses a bad section key, fee type key and a key used twice", () => {
    const input = profile();
    input.sections[0].key = "Fees";
    input.sections[0].feeTypes[1].key = "ads";
    input.sections.push({ ...input.sections[0], key: "x".repeat(33) });
    input.sections.push({ ...structuredClone(input.sections[0]), key: "" });
    input.sections[2].feeTypes = [
      { key: "9lives", description: "", categoryAccountId: null },
    ];
    const errors = validateProfile(input);
    expect(paths(errors)).toEqual([
      "sections[0].key",
      "sections[0].feeTypes[1].key",
      "sections[1].key",
      "sections[1].feeTypes[1].key",
      "sections[2].key",
      "sections[2].feeTypes[0].key",
    ]);
    expect(errors[0].message).toMatch(/lower-case letter/);
    expect(errors[1].message).toMatch(/listed twice/);
  });

  it("refuses two sections with one key", () => {
    const input = profile();
    input.sections.push(structuredClone(input.sections[0]));
    const errors = validateProfile(input);
    expect(paths(errors)).toEqual(["sections[1].key"]);
    expect(errors[0].message).toMatch(/Two sections use the key "fees"/);
  });

  it("refuses a key every plain object already has, which reading would trip on", () => {
    const input = profile();
    input.sections[0].key = "constructor";
    input.sections[0].feeTypes[1].key = "constructor";
    const errors = validateProfile(input);
    expect(paths(errors)).toEqual([
      "sections[0].key",
      "sections[0].feeTypes[1].key",
    ]);
    expect(errors[0].message).toBe(
      '"constructor" cannot be used as a section key. Choose another name.',
    );
  });

  it('refuses "none" as a fee type key or a choice, since the reading uses it for none', () => {
    const input = withExtras({
      type: "object",
      properties: { status: { type: "string", enum: ["paid", "none"] } },
    }) as unknown as ImportProfileDraft;
    input.sections[0].feeTypes[1].key = "none";
    const errors = validateProfile(input);
    expect(paths(errors)).toEqual([
      "sections[0].feeTypes[1].key",
      "sections[0].extras.properties.status.enum[1]",
    ]);
    expect(errors[0].message).toMatch(/none of the fee types/);
  });

  it("refuses an unknown kind", () => {
    const input = profile() as unknown as {
      sections: Record<string, unknown>[];
    };
    input.sections[0].kind = "document";
    expect(paths(validateProfile(input))).toEqual(["sections[0].kind"]);
  });

  it("refuses a category that is not an account id", () => {
    const input = profile() as unknown as {
      sections: {
        fixedCategoryAccountId: unknown;
        feeTypes: { categoryAccountId: unknown }[];
      }[];
    };
    input.sections[0].fixedCategoryAccountId = "Office";
    input.sections[0].feeTypes[0].categoryAccountId = 1.5;
    expect(paths(validateProfile(input))).toEqual([
      "sections[0].fixedCategoryAccountId",
      "sections[0].feeTypes[0].categoryAccountId",
    ]);
  });

  it("refuses repeated and empty phrases", () => {
    const input = profile();
    input.phrases = ["Ads e-Invoice", "ads E-INVOICE", " "];
    expect(paths(validateProfile(input))).toEqual(["phrases[1]", "phrases[2]"]);
  });

  it("refuses text over its limit, naming the length", () => {
    const input = profile();
    input.instructions = "x".repeat(4001);
    const errors = validateProfile(input);
    expect(errors).toEqual([
      {
        path: "instructions",
        message:
          "The instructions can be at most 4000 characters; this has 4001.",
      },
    ]);
  });

  it(`allows ${PROFILE_SECTIONS_MAX} sections and no more`, () => {
    const input = profile();
    const base = input.sections[0];
    input.sections = Array.from({ length: PROFILE_SECTIONS_MAX }, (_, i) => ({
      ...structuredClone(base),
      key: `s${i}`,
      feeTypes: [],
    }));
    expect(validateProfile(input)).toEqual([]);
    input.sections.push({
      ...structuredClone(base),
      key: "extra",
      feeTypes: [],
    });
    expect(paths(validateProfile(input))).toEqual(["sections"]);
  });

  it(`allows ${PROFILE_FEE_TYPES_MAX} fee types in a section and no more`, () => {
    const input = profile();
    input.sections[0].feeTypes = Array.from(
      { length: PROFILE_FEE_TYPES_MAX + 1 },
      (_, i) => ({ key: `fee_${i}`, description: "", categoryAccountId: null }),
    );
    expect(paths(validateProfile(input))).toEqual(["sections[0].feeTypes"]);
  });

  it(`allows ${PROFILE_ENUM_VALUES_MAX} listed values in all, counting fee types and extra choices`, () => {
    const input = profile();
    const fees = (prefix: string, n: number) =>
      Array.from({ length: n }, (_, i) => ({
        key: `${prefix}_${i}`,
        description: "",
        categoryAccountId: null,
      }));
    const base = input.sections[0];
    // 4 sections of 50 fee types: exactly the limit.
    input.sections = ["a", "b", "c", "d"].map((key) => ({
      ...structuredClone(base),
      key,
      feeTypes: fees(key, 50),
    }));
    expect(validateProfile(input)).toEqual([]);

    // One extra choice on the last section is one too many.
    input.sections[3].extras = {
      type: "object",
      properties: { channel: { type: "string", enum: ["web"] } },
    };
    const errors = validateProfile(input);
    expect(paths(errors)).toEqual(["sections[3]"]);
    expect(errors[0].message).toMatch(/at most 200 values in all/);
  });
});

describe("validateExtrasFragment", () => {
  it("accepts flat plain fields, and reads which may be missing", () => {
    const result = validateExtrasFragment(
      JSON.stringify({
        type: "object",
        properties: {
          order_no: { type: "string", description: "The order number" },
          quantity: { type: ["integer", "null"] },
          paid_by_card: { type: "boolean" },
          channel: { type: "string", enum: ["web", "app"] },
        },
        required: ["order_no", "paid_by_card"],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.enumCount).toBe(2);
    expect(extraFieldsOf(result.fragment)).toEqual([
      {
        key: "order_no",
        type: "string",
        nullable: false,
        description: "The order number",
        enum: null,
      },
      {
        key: "quantity",
        type: "integer",
        nullable: true,
        description: null,
        enum: null,
      },
      {
        key: "paid_by_card",
        type: "boolean",
        nullable: false,
        description: null,
        enum: null,
      },
      {
        key: "channel",
        type: "string",
        nullable: true,
        description: null,
        enum: ["web", "app"],
      },
    ]);
  });

  it("reads empty text, null and no properties as no extra fields", () => {
    for (const input of ["", "  ", null, undefined]) {
      expect(validateExtrasFragment(input)).toEqual({
        ok: true,
        fragment: null,
        enumCount: 0,
      });
    }
    expect(
      validateExtrasFragment({ type: "object", properties: {} }),
    ).toMatchObject({ ok: true, fragment: null });
  });

  it("refuses text that is not JSON", () => {
    const result = validateExtrasFragment(
      "{ type: object",
      "sections[2].extras",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].path).toBe("sections[2].extras");
    expect(result.errors[0].message).toMatch(/not valid JSON/);
  });

  it("refuses a name the books already use", () => {
    const errors = validateProfile(
      withExtras({
        type: "object",
        properties: {
          amount: { type: "number" },
          supplier: { type: "string" },
        },
      }),
    );
    expect(errors).toEqual([
      {
        path: "sections[0].extras.properties.amount",
        message:
          '"amount" is a name the books already use for every item. Choose another name.',
      },
      {
        path: "sections[0].extras.properties.supplier",
        message:
          '"supplier" is a name the books already use for every item. Choose another name.',
      },
    ]);
  });

  it("refuses a field name that is not a slug", () => {
    const errors = validateProfile(
      withExtras({
        type: "object",
        properties: { "Order No": { type: "string" } },
      }),
    );
    expect(paths(errors)).toEqual(["sections[0].extras.properties.Order No"]);
  });

  it("refuses nested values", () => {
    const errors = validateProfile(
      withExtras({
        type: "object",
        properties: {
          address: {
            type: "object",
            properties: { street: { type: "string" } },
          },
          tags: { type: "array", items: { type: "string" } },
        },
      }),
    );
    expect(paths(errors)).toEqual([
      "sections[0].extras.properties.address.properties",
      "sections[0].extras.properties.address.type",
      "sections[0].extras.properties.tags.items",
      "sections[0].extras.properties.tags.type",
    ]);
    for (const error of errors) expect(error.message).toMatch(/plain values/);
  });

  it("refuses a keyword outside the whitelist, on the list and on a field", () => {
    const errors = validateProfile(
      withExtras({
        type: "object",
        additionalProperties: false,
        properties: {
          quantity: { type: "integer", minimum: 0 },
          code: { type: "string", $ref: "#/x" },
        },
      }),
    );
    expect(paths(errors)).toEqual([
      "sections[0].extras.additionalProperties",
      "sections[0].extras.properties.quantity.minimum",
      "sections[0].extras.properties.code.$ref",
    ]);
    expect(errors[1].message).toMatch(/"minimum" is not supported/);
  });

  it("refuses a bad type, and an enum that is not text", () => {
    const errors = validateProfile(
      withExtras({
        type: "object",
        properties: {
          a: { type: "date" },
          b: { type: ["string", "number"] },
          c: { type: "number", enum: ["1"] },
          d: { type: "string", enum: [1, "x", "x"] },
          e: { type: "string", enum: [] },
        },
      }),
    );
    expect(paths(errors)).toEqual([
      "sections[0].extras.properties.a.type",
      "sections[0].extras.properties.b.type",
      "sections[0].extras.properties.c.enum",
      "sections[0].extras.properties.d.enum[0]",
      "sections[0].extras.properties.d.enum[2]",
      "sections[0].extras.properties.e.enum",
    ]);
  });

  it("refuses a list that is not an object, and a required name it lacks", () => {
    expect(paths(validateProfile(withExtras([])))).toEqual([
      "sections[0].extras",
    ]);
    expect(
      paths(
        validateProfile(
          withExtras({
            type: "array",
            properties: { a: { type: "string" } },
            required: ["b"],
          }),
        ),
      ),
    ).toEqual(["sections[0].extras.type", "sections[0].extras.required[0]"]);
  });

  it("refuses a built-in object name as a field, or listed as required", () => {
    expect(
      validateProfile(
        withExtras({
          type: "object",
          properties: { constructor: { type: "string" } },
        }),
      ),
    ).toEqual([
      {
        path: "sections[0].extras.properties.constructor",
        message:
          '"constructor" cannot be used as a field name. Choose another name.',
      },
    ]);
    expect(
      paths(
        validateProfile(
          withExtras({
            type: "object",
            properties: { a: { type: "string" } },
            required: ["toString", "constructor"],
          }),
        ),
      ),
    ).toEqual([
      "sections[0].extras.required[0]",
      "sections[0].extras.required[1]",
    ]);
  });

  it(`allows ${PROFILE_EXTRAS_MAX} extra fields in a section and no more`, () => {
    const properties = Object.fromEntries(
      Array.from({ length: PROFILE_EXTRAS_MAX + 1 }, (_, i) => [
        `field_${i}`,
        { type: "string" },
      ]),
    );
    expect(
      paths(validateProfile(withExtras({ type: "object", properties }))),
    ).toEqual(["sections[0].extras.properties"]);
  });
});

describe("formatProfileErrors", () => {
  it("joins the first few problems with their paths", () => {
    const errors = Array.from({ length: 7 }, (_, i) => ({
      path: `p${i}`,
      message: `m${i}.`,
    }));
    expect(formatProfileErrors(errors)).toBe(
      "p0: m0. p1: m1. p2: m2. p3: m3. p4: m4. and 2 more.",
    );
  });
});

describe("table layout and row rules (FR-053, FR-054)", () => {
  function wallet(): Record<string, unknown> {
    return {
      name: "Wallet report",
      description: "A marketplace wallet report.",
      phrases: [],
      instructions: "",
      statedTotalLabels: {},
      accountId: 40,
      layout: walletLayout(),
      sections: [...orderSections(), withdrawalSection(41)],
    };
  }
  type Loose = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  function errorsOf(edit: (value: Loose) => void): ProfileError[] {
    const value = structuredClone(wallet()) as Loose;
    edit(value);
    return validateProfile(value);
  }

  it("keeps a layout and each section's row rules as they are", () => {
    const result = checkProfile(wallet());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile.layout).toEqual(walletLayout());
    expect(result.profile.sections.map((section) => section.rows)).toEqual(
      [...orderSections(), withdrawalSection(41)].map(
        (section) => section.rows,
      ),
    );
  });

  it("fills in the date format and decimal separator when they are left out", () => {
    const value = wallet();
    const layout = { ...walletLayout() } as Loose;
    delete layout.dateFormat;
    delete layout.decimalSeparator;
    delete layout.csvDelimiter;
    value.layout = layout;
    const result = checkProfile(value);
    expect(result.ok && result.profile.layout).toMatchObject({
      dateFormat: "YYYY-MM-DD",
      decimalSeparator: ".",
      csvDelimiter: null,
    });
  });

  it("keeps no layout key on a profile without one, as before", () => {
    const value = wallet();
    delete value.layout;
    value.sections = [{ ...orderSections()[0], rows: undefined }];
    const result = checkProfile(value);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect("layout" in result.profile).toBe(false);
    expect("rows" in result.profile.sections[0]).toBe(false);
  });

  it("refuses a column that is not one of the headings, wherever it is named", () => {
    const errors = errorsOf((value) => {
      value.layout.columns.amount = "Total";
      value.layout.remarkColumns = ["Note"];
      value.sections[0].rows.where[0].column = "Kind";
    });
    expect(paths(errors)).toEqual([
      "layout.columns.amount",
      "layout.remarkColumns[0]",
      "sections[0].rows.where[0].column",
    ]);
    expect(errors[0].message).toBe(
      '"Total" is not one of the table\'s headings. Add it to the headings, or choose one of them.',
    );
    // Headings compare as the reading compares them.
    expect(
      errorsOf((value) => {
        value.layout.columns.amount = "  AMOUNT ";
      }),
    ).toEqual([]);
  });

  it("refuses row rules on a profile with no table layout", () => {
    const errors = errorsOf((value) => {
      delete value.layout;
    });
    expect(paths(errors)).toEqual([
      "sections[0].rows",
      "sections[1].rows",
      "sections[2].rows",
    ]);
    expect(errors[0].message).toMatch(/has no table layout/);
  });

  it("refuses a layout with no headings or a missing column", () => {
    expect(
      paths(
        errorsOf((value) => {
          value.layout = { headers: [], columns: {} };
        }),
      ),
    ).toEqual(
      expect.arrayContaining([
        "layout.headers",
        "layout.columns.date",
        "layout.columns.description",
        "layout.columns.amount",
      ]),
    );
    expect(
      paths(
        errorsOf((value) => {
          value.layout.headers = ["Date", "date"];
        }),
      ),
    ).toContain("layout.headers[1]");
  });

  it("refuses a condition with no value, an unknown comparison or an empty list", () => {
    const errors = errorsOf((value) => {
      value.sections[0].rows.where = [
        { column: "Status", op: "is" },
        { column: "Status", op: "starts_with", value: "x" },
        { column: "Status", op: "is_one_of", values: [] },
        { column: "Status", op: "empty" },
      ];
    });
    expect(paths(errors)).toEqual([
      "sections[0].rows.where[0].value",
      "sections[0].rows.where[1].op",
      "sections[0].rows.where[2].values",
    ]);
  });

  it("needs a note for a flag rule, and a flag rule for a note", () => {
    expect(
      paths(
        errorsOf((value) => {
          value.sections[2].rows.flagNote = "";
        }),
      ),
    ).toEqual(["sections[2].rows.flagNote"]);
    expect(
      paths(
        errorsOf((value) => {
          value.sections[0].rows.flagNote = "Check it.";
        }),
      ),
    ).toEqual(["sections[0].rows.flagNote"]);
  });

  it("ties fee types to their column and values, and no value to two types", () => {
    const withFees = (edit: (section: Loose) => void) =>
      paths(
        errorsOf((value) => {
          value.sections[0].feeTypes = [
            {
              key: "orders",
              description: "",
              categoryAccountId: null,
              values: ["Order Income"],
            },
            {
              key: "refunds",
              description: "",
              categoryAccountId: null,
              values: ["Refund"],
            },
          ];
          value.sections[0].rows.feeTypeColumn = "Transaction Type";
          edit(value.sections[0]);
        }),
      );
    expect(withFees(() => {})).toEqual([]);
    expect(
      withFees((section) => {
        section.rows.feeTypeColumn = null;
      }),
    ).toEqual([
      "sections[0].rows.feeTypeColumn",
      "sections[0].feeTypes[0].values",
      "sections[0].feeTypes[1].values",
    ]);
    expect(
      withFees((section) => {
        section.feeTypes[1].values = [];
      }),
    ).toEqual(["sections[0].feeTypes[1].values"]);
    expect(
      withFees((section) => {
        section.feeTypes[1].values = ["order  income"];
      }),
    ).toEqual(["sections[0].feeTypes[1].values[0]"]);
    expect(
      withFees((section) => {
        section.feeTypes = [];
      }),
    ).toEqual(["sections[0].rows.feeTypeColumn"]);
  });

  it("refuses values on a fee type the AI reads, which has no column to read them from", () => {
    const value = wallet();
    delete value.layout;
    value.sections = [
      {
        ...orderSections()[0],
        rows: undefined,
        feeTypes: [
          {
            key: "orders",
            description: "",
            categoryAccountId: null,
            values: ["Order"],
          },
        ],
      },
    ];
    expect(paths(validateProfile(value))).toEqual([
      "sections[0].feeTypes[0].values",
    ]);
  });

  it("refuses a direction value meaning both ways, a bad currency and an unknown mode", () => {
    const errors = errorsOf((value) => {
      value.layout.direction.out = ["Money Out", "money in"];
      value.layout.currency = "RM";
      value.layout.decimalSeparator = " ";
      value.layout.dateFormat = "D MMM YYYY";
      value.layout.statedTotalLabels = { daily: ["Total"] };
    });
    expect(paths(errors)).toEqual([
      "layout.dateFormat",
      "layout.direction.out[1]",
      "layout.decimalSeparator",
      "layout.currency",
      "layout.statedTotalLabels.daily",
    ]);
  });

  it("says which profiles read a mode from columns: a layout, and rules on every section of it", () => {
    const result = checkProfile(wallet());
    if (!result.ok) throw new Error("not ok");
    const profile = result.profile;
    expect(readsFromColumns(profile, "every_transaction")).toBe(true);
    expect(readsFromColumns(profile, "summary")).toBe(false);
    const mixed = {
      ...profile,
      sections: [
        ...profile.sections,
        { ...profile.sections[0], key: "other", rows: undefined },
      ],
    };
    expect(readsFromColumns(mixed, "every_transaction")).toBe(false);
    expect(
      readsFromColumns({ ...profile, layout: null }, "every_transaction"),
    ).toBe(false);
  });

  it("folds case and spacing the one way the reader does", () => {
    expect(foldTableText("  Money\u00a0 In ")).toBe("money in");
  });
});
