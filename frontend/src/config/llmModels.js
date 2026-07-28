export const LLM_PROVIDERS = {
  openai: {
    label: 'OpenAI',
    defaultModel: 'gpt-5.6-terra',
    keyPlaceholder: 'sk-...',
    models: [
      { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', tier: 'Quality', description: 'Highest capability for complex meetings.' },
      { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', tier: 'Balanced', description: 'Strong quality with balanced cost and latency.' },
      { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', tier: 'Economy', description: 'Fast, cost-sensitive summary generation.' }
    ]
  },
  anthropic: {
    label: 'Anthropic',
    defaultModel: 'claude-sonnet-5',
    keyPlaceholder: 'sk-ant-...',
    models: [
      { id: 'claude-fable-5', label: 'Claude Fable 5', tier: 'Premium', description: 'Maximum capability for demanding knowledge work.' },
      { id: 'claude-opus-5', label: 'Claude Opus 5', tier: 'Quality', description: 'Deep analysis for complex, long meetings.' },
      { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', tier: 'Balanced', description: 'Strong summary quality with fast responses.' },
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', tier: 'Economy', description: 'Fastest Anthropic option for routine meetings.' }
    ]
  },
  deepseek: {
    label: 'DeepSeek',
    defaultModel: 'deepseek-v4-flash',
    keyPlaceholder: 'sk-...',
    models: [
      { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', tier: 'Quality', description: 'Higher-quality reasoning and detailed summaries.' },
      { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', tier: 'Balanced', description: 'Fast, economical summaries with strong quality.' }
    ]
  }
};

export const getProviderConfig = (provider) => LLM_PROVIDERS[provider] || LLM_PROVIDERS.openai;

export const getSelectedModelId = (config) => {
  const provider = LLM_PROVIDERS[config?.provider] ? config.provider : 'openai';
  const providerConfig = LLM_PROVIDERS[provider];
  const selected = config?.models?.[provider];
  return providerConfig.models.some((model) => model.id === selected) ? selected : providerConfig.defaultModel;
};

export const getSelectedModel = (config) => {
  const providerConfig = getProviderConfig(config?.provider);
  const modelId = getSelectedModelId(config);
  return providerConfig.models.find((model) => model.id === modelId);
};

export const getActiveApiKey = (config) => {
  const provider = LLM_PROVIDERS[config?.provider] ? config.provider : 'openai';
  return typeof config?.apiKeys?.[provider] === 'string' ? config.apiKeys[provider] : '';
};

export const normalizeLlmConfig = (storedConfig) => {
  const source = storedConfig && typeof storedConfig === 'object' ? storedConfig : {};
  const provider = LLM_PROVIDERS[source.provider] ? source.provider : 'openai';
  const models = {};
  const apiKeys = {};

  Object.entries(LLM_PROVIDERS).forEach(([providerId, providerConfig]) => {
    const savedModel = source.models?.[providerId];
    models[providerId] = providerConfig.models.some((model) => model.id === savedModel)
      ? savedModel
      : providerConfig.defaultModel;
    apiKeys[providerId] = typeof source.apiKeys?.[providerId] === 'string'
      ? source.apiKeys[providerId]
      : '';
  });

  if (typeof source.model === 'string' && LLM_PROVIDERS[provider].models.some((model) => model.id === source.model)) {
    models[provider] = source.model;
  }
  if (!apiKeys[provider] && typeof source.apiKey === 'string') {
    apiKeys[provider] = source.apiKey;
  }

  return { provider, models, apiKeys };
};
