/**
 * Turns a description of what to read from a document (a reading profile) into
 * the two things a reading needs:
 *
 * 1. The JSON Schema sent to the model, which fixes the shape of its answer.
 * 2. A check of the answer against that same shape, which is what the reading
 *    trusts. It drops keys the schema does not name, because Google's models
 *    ignore `additionalProperties: false` and may add their own.
 *
 * Both come from one model of the fields (`FieldSpec`), so they cannot drift
 * apart. The schema only fixes the shape. Which lines the model picks is
 * guidance (the descriptions and the prompt), and the arithmetic is done in
 * code afterwards (`document-reader.ts`), never by the model.
 *
 * The schema keeps to what every provider accepts: every property is required,
 * a value that may be missing is typed `[T, "null"]`, objects set
 * `additionalProperties: false`, and enums hold strings only. It never uses
 * minimum/maximum, pattern, $ref or anyOf.
 *
 * "Document with several items" is the one built-in profile (below). A saved
 * profile (006 S2) is compiled the same way: it is another `ReadingProfile`
 * with its own sections and a schema id of its own.
 */

import { jsonSchema, type JSONSchema7, type Schema } from "ai";

// ── The field model ─────────────────────────────────────────────────────────

type Described = { description?: string };
type Nullable = { nullable?: boolean };

/** One field of an answer, and what the model is told about it. */
export type FieldSpec =
  | (Described & Nullable & { type: "string"; enum?: readonly string[] })
  | (Described & Nullable & { type: "number" | "integer" | "boolean" })
  | (Described & { type: "array"; items: FieldSpec })
  | (Described &
      Nullable & { type: "object"; properties: Record<string, FieldSpec> });

/** The JSON Schema for one field, as the provider receives it. */
export function toWireSchema(field: FieldSpec): JSONSchema7 {
  const described = field.description ? { description: field.description } : {};
  switch (field.type) {
    case "array":
      return { type: "array", ...described, items: toWireSchema(field.items) };
    case "object": {
      const properties: Record<string, JSONSchema7> = {};
      for (const [key, value] of Object.entries(field.properties)) {
        properties[key] = toWireSchema(value);
      }
      return {
        type: field.nullable ? ["object", "null"] : "object",
        ...described,
        properties,
        required: Object.keys(field.properties),
        additionalProperties: false,
      };
    }
    case "string":
      return {
        type: field.nullable ? ["string", "null"] : "string",
        ...described,
        ...(field.enum ? { enum: [...field.enum] } : {}),
      };
    default:
      return {
        type: field.nullable ? [field.type, "null"] : field.type,
        ...described,
      };
  }
}

/**
 * Checks `value` against `field` and returns a copy that holds only the keys
 * the field names. Each problem is added to `errors` with the path to the value
 * (for example `sections.items[2].amount`), and the returned value is then not
 * to be used.
 *
 * A nullable property the answer leaves out is read as null, because a missing
 * value and an empty one mean the same here. A property that may not be null
 * must be there.
 */
export function checkField(
  field: FieldSpec,
  value: unknown,
  path: string,
  errors: string[],
): unknown {
  const where = path || "the answer";
  if (value === null || value === undefined) {
    if ("nullable" in field && field.nullable) return null;
    errors.push(`${where} is missing`);
    return null;
  }
  switch (field.type) {
    case "string":
      if (typeof value !== "string") {
        errors.push(`${where} must be text`);
      } else if (field.enum && !field.enum.includes(value)) {
        errors.push(`${where} must be one of ${field.enum.join(", ")}`);
      }
      return value;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        errors.push(`${where} must be a number`);
      }
      return value;
    case "integer":
      if (typeof value !== "number" || !Number.isInteger(value)) {
        errors.push(`${where} must be a whole number`);
      }
      return value;
    case "boolean":
      if (typeof value !== "boolean")
        errors.push(`${where} must be true or false`);
      return value;
    case "array":
      if (!Array.isArray(value)) {
        errors.push(`${where} must be a list`);
        return [];
      }
      return value.map((entry, index) =>
        checkField(field.items, entry, `${path}[${index}]`, errors),
      );
    case "object": {
      if (typeof value !== "object" || Array.isArray(value)) {
        errors.push(`${where} must be an object`);
        return {};
      }
      const source = value as Record<string, unknown>;
      const kept: Record<string, unknown> = {};
      for (const [key, property] of Object.entries(field.properties)) {
        kept[key] = checkField(
          property,
          source[key],
          path ? `${path}.${key}` : key,
          errors,
        );
      }
      return kept;
    }
  }
}

// At most this many problems are named in one error, so a reply that is wrong
// throughout does not produce a message thousands of lines long.
const ERRORS_SHOWN = 10;

// ── Reading profiles ────────────────────────────────────────────────────────

/**
 * Whether a section's lines are income or expenses (006 FR-008).
 *
 * - `document`: the whole document is one kind, which the model states in the
 *   header, as it does for a receipt. The built-in reading uses this.
 * - `income` / `expense`: every line of the section is that kind.
 * - `by_sign`: a positive amount is income and a negative one an expense.
 */
export type SectionKind = "document" | "income" | "expense" | "by_sign";

/** One list of lines to read from the document. */
export interface SectionSpec {
  /** The section's key in the answer. Lower-case letters, digits and "_". */
  key: string;
  /** Tells the model which lines belong in this section. */
  description: string;
  kind: SectionKind;
  /**
   * The closed list of fee types a line of this section can be. The answer's
   * `fee_type` is one of them or null, and a null is left out as an ignored
   * line, so a stray line is never forced into the closest type (FR-034).
   * Absent when the section has no fee types; the answer then has no
   * `fee_type` at all.
   */
  feeTypes?: readonly { key: string; description: string }[];
  /**
   * Whether the model picks each line's category from the user's list. False
   * when code decides the category, and the answer then has no
   * `category_account_id`.
   */
  categoryFromModel: boolean;
  /** More fields to read for each line. Flat: text, numbers or true/false. */
  extras?: Record<string, FieldSpec>;
}

/** Everything a reading needs to know about what to read. */
export interface ReadingProfile {
  /**
   * Names the compiled schema for the provider's unsupported cache, with a
   * version (see `StructuredSpec.schemaId`). Change the version whenever the
   * schema this profile compiles to changes.
   */
  schemaId: string;
  /**
   * The rules for picking lines, as prompt lines starting with "- ". They sit
   * under the prompt's opening and above the user's own guidance.
   */
  instructions: string;
  /** Which printed total `stated_total` is, for this profile. */
  statedTotalDescription: string;
  sections: readonly SectionSpec[];
}

/** One line of the document as the model read it. */
export interface ReadItem {
  description: string;
  /** As printed on the line, with its sign. Never added up by the model. */
  amount: number;
  date: string | null;
  reference: string | null;
  /** The number of the line the amount is printed on (the "L0012" prefix). */
  source_line: number | null;
  /** Present only when the section has fee types. */
  fee_type?: string | null;
  /** Present only when the model picks the category. */
  category_account_id?: number | null;
  /** Present only when the section has extra fields. */
  extras?: Record<string, unknown>;
}

/** The model's whole answer, after the check. */
export interface ReadEnvelope {
  header: {
    /** Present only when a section takes its kind from the document. */
    document_type?: "expense" | "income";
    counterparty: string | null;
    date: string | null;
    reference: string | null;
    currency: string | null;
  };
  /** The printed total for exactly the lines read, as printed. */
  stated_total: number | null;
  sections: Record<string, ReadItem[]>;
  ignored: string[];
}

/** A profile ready to send: its schema, and the check of the answer. */
export interface CompiledProfile {
  schemaId: string;
  /** The JSON Schema the provider receives. */
  wire: JSONSchema7;
  /** `wire` with its check attached, for `Output.object`. */
  schema: Schema<ReadEnvelope>;
  /** Checks a value read from reply text. Throws, naming each problem. */
  parse: (raw: unknown) => ReadEnvelope;
}

const SLUG = /^[a-z][a-z0-9_]*$/;

function itemField(section: SectionSpec): FieldSpec {
  const properties: Record<string, FieldSpec> = {
    description: {
      type: "string",
      description:
        "A short label for this line in a few words (under 60 characters), taken from the line's own wording.",
    },
    amount: {
      type: "number",
      description:
        "The amount on this line exactly as printed, as a number with no currency symbol and no thousands separators. Keep the minus sign when the line prints one, or prints the amount in brackets. Never work out or add up a figure yourself.",
    },
    date: {
      type: "string",
      nullable: true,
      description:
        "This line's own date as YYYY-MM-DD, only when the line prints a date of its own. Otherwise null.",
    },
    reference: {
      type: "string",
      nullable: true,
      description:
        "This line's own reference number, only when the line prints one of its own. Otherwise null.",
    },
    source_line: {
      type: "integer",
      nullable: true,
      description:
        "The number after L at the start of the line where this amount is printed, for example 12 for L0012.",
    },
  };
  if (section.feeTypes?.length) {
    properties.fee_type = {
      type: "string",
      nullable: true,
      enum: section.feeTypes.map((feeType) => feeType.key),
      description: `Which fee type this line is. Null when it is none of them. ${section.feeTypes
        .map((feeType) => `${feeType.key}: ${feeType.description}`)
        .join("; ")}`,
    };
  }
  if (section.categoryFromModel) {
    properties.category_account_id = {
      type: "integer",
      nullable: true,
      description:
        "The id of the best matching account from the lists in the instructions. Null when the line does not say enough to choose one. Never invent an id.",
    };
  }
  if (section.extras && Object.keys(section.extras).length > 0) {
    properties.extras = { type: "object", properties: section.extras };
  }
  return {
    type: "array",
    description: section.description,
    items: { type: "object", properties },
  };
}

/** The field model of a profile's whole answer. */
export function envelopeField(profile: ReadingProfile): FieldSpec {
  if (profile.sections.length === 0) {
    throw new Error("A reading profile needs at least one section");
  }
  const header: Record<string, FieldSpec> = {};
  if (profile.sections.some((section) => section.kind === "document")) {
    header.document_type = {
      type: "string",
      enum: ["expense", "income"],
      description:
        "expense when the document is money the user pays out, income when it is money the user receives. The whole document is one kind.",
    };
  }
  header.counterparty = {
    type: "string",
    nullable: true,
    description:
      "The other party's name exactly as printed on the document (the full legal or business name): the supplier for an expense, the customer for income. Never shortened, abbreviated or paraphrased. Null when none is printed.",
  };
  header.date = {
    type: "string",
    nullable: true,
    description: "The document's date as YYYY-MM-DD. Null when it is unclear.",
  };
  header.reference = {
    type: "string",
    nullable: true,
    description:
      "The document's own invoice, statement or reference number. Null when there is none.",
  };
  header.currency = {
    type: "string",
    nullable: true,
    description:
      "The ISO-4217 code the amounts are in (for example USD, MYR, SGD, EUR), from any symbol or code on the document. Null when none is shown.",
  };

  const sections: Record<string, FieldSpec> = {};
  for (const section of profile.sections) {
    if (!SLUG.test(section.key) || section.key in sections) {
      throw new Error(`Section key "${section.key}" is not a unique slug`);
    }
    for (const [key, extra] of Object.entries(section.extras ?? {})) {
      if (
        !SLUG.test(key) ||
        extra.type === "array" ||
        extra.type === "object"
      ) {
        throw new Error(
          `Extra field "${key}" of section "${section.key}" must be a slug holding text, a number or true/false`,
        );
      }
    }
    sections[section.key] = itemField(section);
  }

  return {
    type: "object",
    properties: {
      header: { type: "object", properties: header },
      stated_total: {
        type: "number",
        nullable: true,
        description: profile.statedTotalDescription,
      },
      sections: { type: "object", properties: sections },
      ignored: {
        type: "array",
        description:
          'A short piece of text for each line left out on purpose, such as "Subtotal 1,230.00". At most 20.',
        items: { type: "string" },
      },
    },
  };
}

/** Compiles a profile into the schema sent and the check of the answer. */
export function compileProfile(profile: ReadingProfile): CompiledProfile {
  const field = envelopeField(profile);
  const wire = toWireSchema(field);

  const check = (raw: unknown) => {
    const errors: string[] = [];
    const value = checkField(field, raw, "", errors) as ReadEnvelope;
    if (errors.length === 0) return { success: true as const, value };
    const shown = errors.slice(0, ERRORS_SHOWN).join("; ");
    const more =
      errors.length > ERRORS_SHOWN
        ? ` (and ${errors.length - ERRORS_SHOWN} more)`
        : "";
    return {
      success: false as const,
      error: new Error(`The answer does not fit the schema: ${shown}${more}`),
    };
  };

  return {
    schemaId: profile.schemaId,
    wire,
    schema: jsonSchema<ReadEnvelope>(wire, { validate: check }),
    parse: (raw) => {
      const result = check(raw);
      if (!result.success) throw result.error;
      return result.value;
    },
  };
}

// ── The built-in profile ────────────────────────────────────────────────────

/**
 * "Document with several items (one record each)": every charge line on the
 * document becomes its own record, and the whole document is one kind, expense
 * or income, as a receipt is (006 US1-3, FR-005, FR-008, FR-015).
 */
export const SEVERAL_ITEMS_PROFILE: ReadingProfile = {
  schemaId: "builtin:items@1",
  instructions: `- The document lists several charges, and each one becomes its own record. Put one entry in
  sections.items for each charge line: a line that states one amount for one thing, such as a fee,
  a commission, a service or a product.
- Never list a subtotal, a total, an amount due, a balance or a balance brought forward, a payment
  received, a tax summary, an account or reference number, or any figure that adds up other lines.
- Never list the rows of another table on the document, such as a list of orders or transactions.
- Credits, discounts and refunds are not charges. Do not list them in sections.items; add them to
  ignored.
- Every item shares the document's other party, date, reference and currency, given once in the
  header. Give an item its own date or reference only when its line prints one of its own.
- Copy every amount exactly as printed. Never add up, subtract or work out a figure yourself.`,
  statedTotalDescription:
    "The total the document prints for exactly the lines listed in sections.items, as printed, with no currency symbol, for example the total of charges. Never an amount due, a balance, or a grand total that includes other charges. Null when the document prints no such total.",
  sections: [
    {
      key: "items",
      description: "One entry for each charge line on the document.",
      kind: "document",
      categoryFromModel: true,
    },
  ],
};
