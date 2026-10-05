import type { JSONSchema7 } from "ai";
import { describe, expect, it } from "vitest";
import { checkProfile } from "$lib/import-profile-schema.js";
import { IMPORT_PROFILE_STARTERS } from "$lib/import-profile-starters.js";
import {
  SEVERAL_ITEMS_PROFILE,
  compileHeaderPart,
  compileLinesPart,
  compileProfile,
  savedReadingProfile,
  type ReadingProfile,
  type SavedProfile,
} from "./profile-compiler.js";

// A profile shaped like the ones users will save (006 S2): two sections with
// fixed kinds, fee types, a category decided in code, and extra fields. It is
// here to show the compiler takes a profile as just another input.
const feeProfile: ReadingProfile = {
  schemaId: "test:fees@1",
  instructions: "- Read the fee lines.",
  statedTotalDescription: "Total fees, as printed.",
  sections: [
    {
      key: "fees",
      description: "Each fee line.",
      kind: "expense",
      categoryFromModel: false,
      feeTypes: [
        { key: "commission", description: "Commission on a sale" },
        { key: "shipping", description: "Shipping charged to the seller" },
      ],
      extras: {
        order_count: { type: "integer", nullable: true },
        note: { type: "string", nullable: true, description: "Any note" },
      },
    },
    {
      key: "payouts",
      description: "Each payout line.",
      kind: "by_sign",
      categoryFromModel: true,
    },
  ],
};

// A sample answer the tests reach into and change freely.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = Record<string, any>;

// What a property or `items` of a JSON Schema holds.
type JSONSchema7Definition = JSONSchema7 | boolean;

// The only keywords the compiled schema may use: what every provider accepts.
const ALLOWED_KEYWORDS = new Set([
  "type",
  "description",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
]);

function asSchema(definition: JSONSchema7Definition | undefined): JSONSchema7 {
  if (!definition || typeof definition !== "object") {
    throw new Error("expected a schema object");
  }
  return definition;
}

function walk(schema: JSONSchema7, visit: (node: JSONSchema7) => void) {
  visit(schema);
  for (const child of Object.values(schema.properties ?? {})) {
    walk(asSchema(child), visit);
  }
  if (schema.items)
    walk(asSchema(schema.items as JSONSchema7Definition), visit);
}

function types(schema: JSONSchema7): string[] {
  return Array.isArray(schema.type) ? schema.type : [schema.type as string];
}

// What the check gives back for a sample: "none", the last choice of a list
// that may be empty, is read as null (see `toWireSchema`).
function noneAsNull(value: unknown): unknown {
  if (value === "none") return null;
  if (Array.isArray(value)) return value.map(noneAsNull);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, noneAsNull(entry)]),
    );
  }
  return value;
}

// Builds values the wire schema admits, straight from the schema: `fill`
// picks what to do where a choice exists. This does not read the field model,
// so it checks that the schema and the check agree.
type Choice = "full" | "nulls" | "last";
function sample(schema: JSONSchema7, choice: Choice): unknown {
  const allowed = types(schema);
  if (choice === "nulls" && allowed.includes("null")) return null;
  const type = allowed.find((t) => t !== "null");
  switch (type) {
    case "object": {
      const value: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(schema.properties ?? {})) {
        value[key] = sample(asSchema(child), choice);
      }
      return value;
    }
    case "array": {
      const count = choice === "nulls" ? 0 : 2;
      return Array.from({ length: count }, () =>
        sample(asSchema(schema.items as JSONSchema7Definition), choice),
      );
    }
    case "string": {
      const values = (schema.enum as string[] | undefined) ?? ["text"];
      return choice === "last" ? values[values.length - 1] : values[0];
    }
    case "number":
      return choice === "last" ? -1234.5 : 0;
    case "integer":
      return choice === "last" ? 42 : 0;
    case "boolean":
      return choice === "last";
    default:
      throw new Error(`unexpected type ${type}`);
  }
}

describe("compileProfile — built-in several items", () => {
  const compiled = compileProfile(SEVERAL_ITEMS_PROFILE);

  it("compiles to the schema the providers receive", () => {
    expect(compiled.schemaId).toBe("builtin:items@1");
    expect(compiled.wire).toMatchSnapshot();
  });

  it("keeps to the keywords every provider accepts", () => {
    walk(compiled.wire, (node) => {
      for (const keyword of Object.keys(node)) {
        expect(ALLOWED_KEYWORDS.has(keyword), keyword).toBe(true);
      }
      if (types(node).includes("object")) {
        expect(node.required).toEqual(Object.keys(node.properties ?? {}));
        expect(node.additionalProperties).toBe(false);
      }
      for (const value of node.enum ?? []) expect(typeof value).toBe("string");
    });
  });

  it("asks for the document's kind in the header, and a category per line", () => {
    const header = asSchema(compiled.wire.properties?.header);
    expect(header.properties?.document_type).toMatchObject({
      type: "string",
      enum: ["expense", "income"],
    });
    const items = asSchema(
      asSchema(compiled.wire.properties?.sections).properties?.items,
    );
    const item = asSchema(items.items as JSONSchema7Definition);
    expect(Object.keys(item.properties ?? {})).toEqual([
      "description",
      "amount",
      "date",
      "reference",
      "source_line",
      "category_account_id",
    ]);
  });

  it.each<Choice>(["full", "nulls", "last"])(
    "accepts every value the schema admits (%s)",
    (choice) => {
      const value = sample(compiled.wire, choice);
      expect(compiled.parse(value)).toEqual(noneAsNull(value));
      expect(compiled.schema.validate?.(value)).toEqual({
        success: true,
        value,
      });
    },
  );

  it("drops keys the schema does not name, at every level", () => {
    const value = sample(compiled.wire, "full") as Record<string, unknown>;
    const noisy = structuredClone(value) as Loose;
    noisy.confidence = 0.9;
    noisy.header.tax_id = "123";
    noisy.sections.orders = [{ id: 1 }];
    noisy.sections.items[0].tax = 1.5;

    expect(compiled.parse(noisy)).toEqual(value);
  });

  it("never lets a model set what only a reading from columns sets", () => {
    const value = sample(compiled.wire, "full") as Record<string, unknown>;
    const noisy = structuredClone(value) as Loose;
    noisy.stated_total_minor = 1;
    noisy.sections.items[0].amount_minor = 1;
    noisy.sections.items[0].review_note = "Approved by the system.";

    expect(compiled.parse(noisy)).toEqual(value);
  });

  it("reads a missing value that may be null as null", () => {
    const value = sample(compiled.wire, "full") as Loose;
    delete value.stated_total;
    delete value.sections.items[0].reference;

    const parsed = compiled.parse(value);
    expect(parsed.stated_total).toBeNull();
    expect(parsed.sections.items[0].reference).toBeNull();
  });

  it("names the path of each value that does not fit", () => {
    const value = sample(compiled.wire, "full") as Loose;
    value.sections.items[1].amount = "1,080.00";
    value.header.document_type = "refund";
    delete value.ignored;

    expect(() => compiled.parse(value)).toThrow(
      "header.document_type must be one of expense, income; sections.items[1].amount must be a number; ignored is missing",
    );
    expect(compiled.schema.validate?.(value)).toMatchObject({
      success: false,
    });
  });

  it("refuses an answer that is not an object", () => {
    expect(() => compiled.parse([])).toThrow("the answer must be an object");
  });
});

describe("compileProfile — a saved profile's shape", () => {
  const compiled = compileProfile(feeProfile);
  const sections = asSchema(compiled.wire.properties?.sections);
  const fee = asSchema(
    asSchema(sections.properties?.fees).items as JSONSchema7Definition,
  );
  const payout = asSchema(
    asSchema(sections.properties?.payouts).items as JSONSchema7Definition,
  );

  it("asks for the document's kind only when a section takes it", () => {
    const header = asSchema(compiled.wire.properties?.header);
    expect(header.properties).not.toHaveProperty("document_type");
  });

  it("gives a section with fee types a string enum with a choice for none, and no category", () => {
    // Not ["string", "null"]: a strict provider allows only the enum's values,
    // so "none" is one of them (and Google refuses a null inside an enum).
    expect(fee.properties?.fee_type).toMatchObject({
      type: "string",
      enum: ["commission", "shipping", "none"],
    });
    expect(asSchema(fee.properties?.fee_type).description).toContain(
      "commission: Commission on a sale",
    );
    expect(asSchema(fee.properties?.fee_type).description).toContain(
      '"none" when none of the others applies.',
    );
    expect(fee.properties).not.toHaveProperty("category_account_id");
    expect(fee.properties?.extras).toMatchObject({
      type: "object",
      required: ["order_count", "note"],
      additionalProperties: false,
    });
  });

  it("gives a section without fee types no fee_type, and a category", () => {
    expect(payout.properties).not.toHaveProperty("fee_type");
    expect(payout.properties).toHaveProperty("category_account_id");
    expect(payout.properties).not.toHaveProperty("extras");
  });

  it.each<Choice>(["full", "nulls", "last"])(
    "accepts every value the schema admits (%s)",
    (choice) => {
      const value = sample(compiled.wire, choice);
      expect(compiled.parse(value)).toEqual(noneAsNull(value));
    },
  );

  it("reads none (or a null) as no fee type, but refuses an unknown one", () => {
    const value = sample(compiled.wire, "full") as Loose;
    value.sections.fees[0].fee_type = "none";
    expect(compiled.parse(value).sections.fees[0].fee_type).toBeNull();
    value.sections.fees[0].fee_type = null;
    expect(compiled.parse(value).sections.fees[0].fee_type).toBeNull();

    value.sections.fees[1].fee_type = "rent";
    expect(() => compiled.parse(value)).toThrow(
      "sections.fees[1].fee_type must be one of commission, shipping",
    );
  });

  it("refuses a section key that is not a unique slug", () => {
    const bad = (key: string) => ({
      ...feeProfile,
      sections: [feeProfile.sections[1], { ...feeProfile.sections[1], key }],
    });
    expect(() => compileProfile(bad("Payouts"))).toThrow("not a unique slug");
    expect(() => compileProfile(bad("payouts"))).toThrow("not a unique slug");
  });

  it("refuses an extra field that is not flat", () => {
    expect(() =>
      compileProfile({
        ...feeProfile,
        sections: [
          {
            ...feeProfile.sections[0],
            extras: { lines: { type: "array", items: { type: "string" } } },
          },
        ],
      }),
    ).toThrow('Extra field "lines"');
  });

  it("refuses a profile with no sections", () => {
    expect(() => compileProfile({ ...feeProfile, sections: [] })).toThrow(
      "at least one section",
    );
  });
});

// ── Saved import profiles (006 S2) ──────────────────────────────────────────

/** A saved profile, checked by the same validator the editor and server use. */
function saved(input: unknown, id = 7): SavedProfile {
  const checked = checkProfile(input);
  if (!checked.ok) throw new Error(JSON.stringify(checked.errors));
  return { id, ...checked.profile };
}

function sectionItem(wire: JSONSchema7, key: string): JSONSchema7 {
  const sections = asSchema(wire.properties?.sections);
  return asSchema(
    asSchema(sections.properties?.[key]).items as JSONSchema7Definition,
  );
}

const shopLike = {
  name: "Shop statement",
  description: "A marketplace's monthly statement.",
  phrases: [],
  instructions: "- Shop guidance from the profile.",
  mode: "summary",
  statedTotalLabels: { summary: "Total Payout Released" },
  sections: [
    {
      key: "sales",
      name: "Sales",
      description: "The product price line at the top.",
      kind: "income",
      fixedCategoryAccountId: 21,
      feeTypes: [],
      extras: null,
    },
    {
      key: "fees",
      name: "Fees and rebates",
      description: "Every other leaf line of the summary.",
      kind: "by_sign",
      fixedCategoryAccountId: null,
      feeTypes: [
        {
          key: "commission_fee",
          description: "Commission",
          categoryAccountId: 11,
        },
        { key: "ads_fee", description: "Advertising", categoryAccountId: null },
      ],
      extras: {
        type: "object",
        properties: {
          order_no: { type: "string", description: "The order number" },
          units: { type: ["integer", "null"] },
          channel: { type: "string", enum: ["web", "app"] },
        },
        required: ["order_no"],
      },
    },
    {
      key: "pinned",
      name: "Pinned fees",
      description: "Lines whose fee types all have a category.",
      kind: "expense",
      fixedCategoryAccountId: null,
      feeTypes: [
        { key: "service_fee", description: "Service", categoryAccountId: 12 },
      ],
      extras: null,
    },
  ],
};

describe("the parts of a reading in pieces (FR-043)", () => {
  it("splits the whole answer's schema into its header and its lines, unchanged", () => {
    const whole = compileProfile(feeProfile).wire;
    const header = compileHeaderPart(feeProfile);
    const lines = compileLinesPart(feeProfile);
    const properties = (wire: JSONSchema7) =>
      wire.properties as Record<string, JSONSchema7>;

    expect(header.schemaId).toBe("test:fees@1#header");
    expect(lines.schemaId).toBe("test:fees@1#lines");
    expect(Object.keys(properties(header.wire))).toEqual([
      "header",
      "stated_total",
    ]);
    expect(Object.keys(properties(lines.wire))).toEqual([
      "sections",
      "ignored",
    ]);
    expect(properties(header.wire).header).toEqual(properties(whole).header);
    expect(properties(header.wire).stated_total).toEqual(
      properties(whole).stated_total,
    );
    expect(properties(lines.wire).sections).toEqual(properties(whole).sections);
    expect(properties(lines.wire).ignored).toEqual(properties(whole).ignored);
  });

  it("checks each part's answer against its own shape only", () => {
    const lines = compileLinesPart(feeProfile);
    // A key the part does not name is dropped, as for the whole answer.
    expect(
      lines.parse({
        sections: { fees: [], payouts: [], refunds: [] },
        ignored: [],
        header: { counterparty: "x" },
      }),
    ).toEqual({ sections: { fees: [], payouts: [] }, ignored: [] });
    expect(() => lines.parse({ sections: {}, ignored: [] })).toThrow(
      /sections\.fees is missing/,
    );
    const header = compileHeaderPart(feeProfile);
    expect(() => header.parse({ stated_total: 1 })).toThrow(
      /header is missing/,
    );
  });
});

describe("savedReadingProfile", () => {
  const reading = savedReadingProfile(saved(shopLike));
  const compiled = compileProfile(reading);

  // A wallet report starter is read from its columns, by code: it sends no
  // schema anywhere unless its row rules are removed (columns-reading.spec).
  it.each(
    IMPORT_PROFILE_STARTERS.filter((starter) => !starter.draft.layout).map(
      (starter) => [starter.id, starter],
    ),
  )(
    "compiles the %s starter to the schema the providers receive",
    (_id, starter) => {
      const profile = savedReadingProfile(saved(starter.draft, 1));
      const wire = compileProfile(profile).wire;
      expect(wire).toMatchSnapshot();
      walk(wire, (node) => {
        for (const keyword of Object.keys(node)) {
          expect(ALLOWED_KEYWORDS.has(keyword), keyword).toBe(true);
        }
        for (const value of node.enum ?? []) {
          expect(typeof value).toBe("string");
        }
        // A list of choices is never also typed null: a strict provider
        // could then not return the null (see `toWireSchema`).
        if (node.enum) expect(types(node)).not.toContain("null");
      });
    },
  );

  it.each<Choice>(["full", "nulls", "last"])(
    "accepts every value its schema admits (%s)",
    (choice) => {
      const value = sample(compiled.wire, choice);
      expect(compiled.parse(value)).toEqual(noneAsNull(value));
    },
  );

  it("names the schema by the profile and a hash of what is sent", () => {
    expect(reading.schemaId).toMatch(/^profile:7:[0-9a-f]{64}$/);
    // The same profile gives the same id; any change to what is sent gives
    // another, so a provider's answer about one is never applied to the other.
    expect(savedReadingProfile(saved(shopLike)).schemaId).toBe(
      reading.schemaId,
    );
    const renamed = saved({
      ...shopLike,
      sections: [
        { ...shopLike.sections[0], name: "Product sales" },
        ...shopLike.sections.slice(1),
      ],
    });
    expect(savedReadingProfile(renamed).schemaId).not.toBe(reading.schemaId);
    expect(savedReadingProfile(saved(shopLike, 8)).schemaId).toMatch(
      /^profile:8:/,
    );
  });

  it("fails a read the provider refuses, and takes its own instructions in place of the general ones", () => {
    expect(reading.schemaRequired).toBe(true);
    expect(reading.guidance).toBe("- Shop guidance from the profile.");
    expect(SEVERAL_ITEMS_PROFILE.guidance).toBeUndefined();
    expect(SEVERAL_ITEMS_PROFILE.schemaRequired).toBeUndefined();
  });

  it("asks for a category only where code does not decide it", () => {
    // A fixed category and no fee types: code decides.
    expect(sectionItem(compiled.wire, "sales").properties).not.toHaveProperty(
      "category_account_id",
    );
    // One fee type has no category: the model suggests one for its lines.
    expect(sectionItem(compiled.wire, "fees").properties).toHaveProperty(
      "category_account_id",
    );
    // Every fee type is tied to a category: code decides.
    expect(sectionItem(compiled.wire, "pinned").properties).not.toHaveProperty(
      "category_account_id",
    );
    expect(
      reading.sections.map((section) => section.categoryFromModel),
    ).toEqual([false, true, false]);
  });

  it("gives fee types an enum with none and keeps the tied categories for code", () => {
    const fee = asSchema(
      sectionItem(compiled.wire, "fees").properties?.fee_type,
    );
    expect(fee).toMatchObject({
      type: "string",
      enum: ["commission_fee", "ads_fee", "none"],
    });
    expect(fee.description).toContain("ads_fee: Advertising");
    expect(sectionItem(compiled.wire, "sales").properties).not.toHaveProperty(
      "fee_type",
    );
    expect(reading.sections[1].feeTypes).toEqual([
      {
        key: "commission_fee",
        description: "Commission",
        categoryAccountId: 11,
      },
      { key: "ads_fee", description: "Advertising", categoryAccountId: null },
    ]);
    expect(reading.sections[0].fixedCategoryAccountId).toBe(21);
  });

  it("builds the extra fields from the checked fragment, every one required and nullable", () => {
    const extras = asSchema(
      sectionItem(compiled.wire, "fees").properties?.extras,
    );
    expect(extras.required).toEqual(["order_no", "units", "channel"]);
    // order_no is required in the fragment, yet still nullable: a line that
    // does not print it must be able to say so rather than make one up.
    expect(extras.properties).toEqual({
      order_no: {
        type: ["string", "null"],
        description: "The order number",
      },
      units: { type: ["integer", "null"] },
      channel: {
        type: "string",
        description: '"none" when none of the others applies.',
        enum: ["web", "app", "none"],
      },
    });
  });

  it("accepts a line that does not print a required extra field", () => {
    const value = sample(compiled.wire, "full") as Loose;
    value.sections.fees[0].extras = {
      order_no: null,
      units: null,
      channel: "none",
    };
    expect(compiled.parse(value).sections.fees[0].extras).toEqual({
      order_no: null,
      units: null,
      channel: null,
    });
  });

  it("describes each section by its name, guidance and kind, and the stated total by its label", () => {
    const sections = asSchema(compiled.wire.properties?.sections);
    const fees = asSchema(sections.properties?.fees);
    expect(fees.description).toContain(
      "Fees and rebates: Every other leaf line of the summary.",
    );
    expect(fees.description).toContain("minus sign");
    expect(asSchema(sections.properties?.sales).description).toContain(
      "money the user receives",
    );
    expect(
      asSchema(compiled.wire.properties?.stated_total).description,
    ).toContain("Total Payout Released");
  });

  it("has no stated total when the profile names none", () => {
    const profile = savedReadingProfile(
      saved({ ...shopLike, statedTotalLabels: {} }),
    );
    expect(profile.statedTotalDescription).toBeNull();
    expect(
      asSchema(compileProfile(profile).wire.properties?.stated_total)
        .description,
    ).toContain("Always null");
  });

  it("throws, naming the profile, when it has no section to read", () => {
    // Every saved profile has a section; a row with none is damaged, and the
    // worker names it before compiling (process-job.ts).
    const attempt = () =>
      savedReadingProfile({ ...saved(shopLike), sections: [] });
    expect(attempt).toThrow(
      'The import profile "Shop statement" has no section to read.',
    );
  });

  it("reads a legacy profile with sections in both modes in its own mode only (FR-032)", () => {
    // As a profile saved when each section had its own mode comes back from
    // the database: the profile mode worked out as Summary, one section still
    // marked Every transaction, and a stated total kept under each mode.
    const legacy: SavedProfile = {
      ...saved(shopLike),
      statedTotalLabels: {
        summary: "Total Payout Released",
        every_transaction: "Total Money In",
      },
      sections: [
        ...saved(shopLike).sections,
        {
          key: "rows",
          name: "Transactions",
          description: "One line per row of the transaction table.",
          mode: "every_transaction",
          kind: "by_sign",
          fixedCategoryAccountId: 21,
          feeTypes: [],
          extras: null,
        },
      ],
    };

    const summary = savedReadingProfile(legacy);
    expect(summary.sections.map((section) => section.key)).toEqual([
      "sales",
      "fees",
      "pinned",
    ]);
    expect(summary.statedTotalDescription).toContain(
      "The figure the document prints for: Total Payout Released.",
    );
    expect(summary.statedTotalDescription).not.toContain("Money In");
    expect(summary.ownReferencesOnly).toBeUndefined();

    // Changed to Every transaction, the same profile reads every section
    // that has no other mode, and the other mode's total.
    const every = savedReadingProfile({ ...legacy, mode: "every_transaction" });
    expect(every.sections.map((section) => section.key)).toEqual([
      "sales",
      "fees",
      "pinned",
      "rows",
    ]);
    expect(every.statedTotalDescription).toContain(
      "The figure the document prints for: Total Money In.",
    );
    // The two readings send different schemas, so they are named apart.
    expect(every.schemaId).not.toBe(summary.schemaId);
  });

  it("reads every section of an Every transaction profile with only its own references (FR-062)", () => {
    const profile = savedReadingProfile(
      saved({
        ...shopLike,
        mode: "every_transaction",
        statedTotalLabels: { every_transaction: "Total Money In" },
      }),
    );
    expect(profile.sections.map((section) => section.key)).toEqual([
      "sales",
      "fees",
      "pinned",
    ]);
    expect(profile.ownReferencesOnly).toBe(true);
    expect(profile.statedTotalDescription).toContain("Total Money In");
  });

  it("has no stated total when the label is kept under the other mode", () => {
    // A legacy row may keep a Summary label on an Every transaction profile:
    // it is never borrowed for the profile's own mode.
    const profile = savedReadingProfile({
      ...saved({
        ...shopLike,
        mode: "every_transaction",
        statedTotalLabels: {},
      }),
      statedTotalLabels: { summary: "Total Payout Released" },
    });
    expect(profile.statedTotalDescription).toBeNull();
  });
});
