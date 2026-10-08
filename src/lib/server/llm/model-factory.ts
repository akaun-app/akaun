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
import { createChatgptFetch } from './chatgpt-fetch.js';
import { CHATGPT_API_BASE } from './chatgpt-oauth.js';
import { createTokenSource, dbCredentialStore } from './chatgpt-tokens.js';

export type LLMProviderType = 'openrouter' | 'google_ai_studio' | 'groq' | 'chatgpt';

export interface LLMProviderConfig {
	/** The `llm_providers` row id. A `chatgpt` provider reads its tokens by it. */
	id?: string;
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
		case 'chatgpt': {
			// A ChatGPT plan, signed in with OAuth (Sign in with ChatGPT). Same
			// Responses API as OpenAI's own; the fetch carries the token and the
			// preview's request rules (chatgpt-fetch.ts).
			if (!config.id) throw new Error(`Provider ${config.name} has no id to read its sign-in by`);
			const tokens = createTokenSource(config.id, dbCredentialStore);
			return createOpenAI({
				baseURL: CHATGPT_API_BASE,
				// Replaced per request by the signed-in token.
				apiKey: 'chatgpt-plan',
				fetch: createChatgptFetch(tokens, fetch, config.id) as typeof fetch
			})(config.model);
		}
		default:
			throw new Error(`Unknown provider type: ${config.type}`);
	}
}
