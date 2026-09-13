import type { ProviderConfig } from '../../../main/ai/provider';

export function snapshotAIRequestConfig(
  input: { name: string; apiKey: string; model: string; baseUrl?: string },
  modelOverride?: string,
): ProviderConfig {
  const override = modelOverride?.trim();
  const name = String(input.name ?? '').trim();
  if (!name) throw new Error('Provider name 不能为空');
  const snap: ProviderConfig = {
    name,
    apiKey: String(input.apiKey ?? '').trim(),
    model: override ? override : String(input.model ?? '').trim(),
  };
  const baseUrl = input.baseUrl?.trim();
  if (baseUrl) snap.baseUrl = baseUrl;
  return snap;
}
