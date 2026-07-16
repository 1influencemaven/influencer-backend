export const LLM_PROVIDER_TOKEN = 'LLM_PROVIDER';

export type AiProviderType = 'cursor' | 'anthropic' | 'mock';

export interface LlmProvider {
  readonly name: AiProviderType;
  readonly model: string;
  complete(prompt: string): Promise<string>;
}
