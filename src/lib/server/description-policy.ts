/** One policy for import extraction and external-agent cleanup suggestions. */
export const DESCRIPTION_POLICY = {
  version: "1",
  targetLength: 60,
  importMaximumLength: 80,
  recordMaximumLength: 500,
  rules: [
    "Use a short noun phrase describing the goods, service or purpose, in sentence case.",
    "Use consistent terminology for equivalent goods and services. Preserve product names and meaningful models.",
    "Use English unless the user's additional guidance requests another language.",
    "Keep a service period only when the document explicitly supports it; never infer it from the transaction date.",
    "Avoid redundant supplier names, amounts, payment methods and receipt numbers stored in separate fields, unless needed to identify the item.",
    "Preserve factual distinctions: a laptop purchase and laptop repair are different descriptions.",
    "Do not invent a purpose, merchant identity or billing period. Flag ambiguous existing descriptions for review.",
  ],
  examples: [
    {
      before: "Monthly subscription payment for GitHub Copilot",
      after: "GitHub Copilot subscription",
    },
    {
      before: "Purchasing paper and ink for office use",
      after: "Printer paper and ink",
    },
  ],
} as const;

export function descriptionPolicyPrompt(): string {
  return `Description style policy v${DESCRIPTION_POLICY.version} (applies to item_name):\n${DESCRIPTION_POLICY.rules.map((rule) => `- ${rule}`).join("\n")}\nExamples, only when supported by the document:\n${DESCRIPTION_POLICY.examples.map((example) => `- ${example.before} -> ${example.after}`).join("\n")}`;
}
