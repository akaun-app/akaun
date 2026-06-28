export type { LLMResult } from "./shared.js";

export type ProviderType = "openrouter" | "google_ai_studio" | "groq";

export interface LLMCallParams {
  text: string;
  expenseCategories: string[];
  incomeCategories: string[];
  mainCurrency: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  isFree: boolean;
}
