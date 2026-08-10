// Builds a Vercel AI SDK `LanguageModel` from a stored provider configuration.
//
// Shared by every feature that calls an LLM (auto-import's receipt extraction,
// reconciliation's statement parsing). Lives here rather than inside `import/`
// so a second feature depends on a shared module rather than sideways on
// another feature.

import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createGroq } from '@ai-sdk/groq';
import type { LanguageModel } from 'ai';

export type LLMProviderType = 'openrouter' | 'google_ai_studio' | 'groq';

export interface LLMProviderConfig {
	type: string;
	model: string;
	apiKey: string;
	baseUrl?: string | null;
	name: string;
}

export function createModel(config: LLMProviderConfig): LanguageModel {
	switch (config.type as LLMProviderType) {
		case 'openrouter':
			return createOpenAI({
				baseURL: config.baseUrl ?? 'https://openrouter.ai/api/v1',
				apiKey: config.apiKey
			})(config.model);
		case 'google_ai_studio':
			return createGoogleGenerativeAI({ apiKey: config.apiKey })(config.model);
		case 'groq':
			return createGroq({ apiKey: config.apiKey })(config.model);
		default:
			throw new Error(`Unknown provider type: ${config.type}`);
	}
}
