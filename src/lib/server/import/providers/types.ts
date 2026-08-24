export type { LLMResult } from "./shared.js";

// The provider union lives with the model factory that switches on it, so a
// feature calling an LLM never has to reach into `import/` for the type.
export type { LLMProviderType as ProviderType } from "../../llm/model-factory.js";

export interface LLMCallParams {
  text: string;
  expenseAccounts: import("./shared.js").ImportAccountChoice[];
  incomeAccounts: import("./shared.js").ImportAccountChoice[];
  mainCurrency: string;
  customInstructions?: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  isFree: boolean;
}
