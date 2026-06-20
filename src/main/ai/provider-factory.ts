import type { AIProvider, ProviderConfig } from './provider';
import { ClaudeProvider } from './providers/claude';
import { OpenAIProvider } from './providers/openai';

export class ProviderFactory {
  static create(config: ProviderConfig): AIProvider {
    switch (config.name.toLowerCase()) {
      case 'claude':
        return new ClaudeProvider(config);
      case 'openai':
        return new OpenAIProvider(config);
      default:
        throw new Error(`Unknown AI provider: ${config.name}`);
    }
  }

  static getAvailableProviders(): string[] {
    return ['claude', 'openai'];
  }
}
