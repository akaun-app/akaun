// Client+server-safe default accent-color swatches for the PDF theme picker
// (`ColorPicker` in Settings › Templates). Chosen to sit quietly on white
// paper — muted warm and cool tones plus one light grey — rather than the
// saturated brand-style colors a generic color picker defaults to.

export type ThemePreset = { hex: string; label: string };

export const PDF_THEME_PRESETS: ThemePreset[] = [
  { hex: "#B8794F", label: "Clay" },
  { hex: "#A98953", label: "Sand" },
  { hex: "#7C8560", label: "Moss" },
  { hex: "#5C7A93", label: "Slate" },
  { hex: "#4F8888", label: "Teal" },
  { hex: "#6B6FA0", label: "Indigo" },
  { hex: "#9CA3AC", label: "Grey" },
];

// Muted continuation of the old saturated blue default (#1a56db).
export const DEFAULT_PDF_THEME_COLOR = "#5C7A93";
