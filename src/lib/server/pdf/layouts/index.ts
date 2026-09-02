import type { LayoutRenderData, ThemeData } from "$lib/pdf/render-types.js";
import { DEFAULT_LAYOUT_KEY, type LayoutKey } from "$lib/pdf/layout-catalog.js";
import { renderClassic } from "./classic.js";
import { renderCompact } from "./compact.js";

export type LayoutRenderFn = (
  data: LayoutRenderData,
  theme: ThemeData,
  title: string,
) => Promise<Buffer>;

const REGISTRY: Record<LayoutKey, LayoutRenderFn> = {
  classic: renderClassic,
  compact: renderCompact,
};

/** Falls back to the default layout for an unknown or missing key. */
export function getLayout(key: string | null | undefined): LayoutRenderFn {
  return REGISTRY[key as LayoutKey] ?? REGISTRY[DEFAULT_LAYOUT_KEY];
}
