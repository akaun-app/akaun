// Client+server-safe metadata for the fixed set of PDF layouts. Each entry's
// `key` must have a matching render function registered in
// $lib/server/pdf/layouts/index.ts. Adding a layout = one new server-side
// render file + one registry line + one entry here.

export type LayoutKey = "classic" | "compact";

export type LayoutCatalogEntry = {
  key: LayoutKey;
  label: string;
  description: string;
};

export const LAYOUT_CATALOG: LayoutCatalogEntry[] = [
  {
    key: "classic",
    label: "Classic",
    description:
      "A tight, receipt-style layout: bold title, label/value details, two address columns, and a bold total.",
  },
  {
    key: "compact",
    label: "Compact",
    description:
      "A tighter single-column layout with smaller type and less whitespace, so more fits on one page.",
  },
];

export const DEFAULT_LAYOUT_KEY: LayoutKey = "classic";

export function isLayoutKey(value: unknown): value is LayoutKey {
  return (
    typeof value === "string" && LAYOUT_CATALOG.some((l) => l.key === value)
  );
}
