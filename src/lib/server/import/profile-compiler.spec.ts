import type { JSONSchema7 } from "ai";
import { describe, expect, it } from "vitest";
import {
  SEVERAL_ITEMS_PROFILE,
  compileProfile,
  type ReadingProfile,
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
      expect(compiled.parse(value)).toEqual(value);
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

  it("gives a section with fee types a nullable string enum, and no category", () => {
    expect(fee.properties?.fee_type).toMatchObject({
      type: ["string", "null"],
      enum: ["commission", "shipping"],
    });
    expect(asSchema(fee.properties?.fee_type).description).toContain(
      "commission: Commission on a sale",
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
      expect(compiled.parse(value)).toEqual(value);
    },
  );

  it("accepts a null fee type but not an unknown one", () => {
    const value = sample(compiled.wire, "full") as Loose;
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
