const LLM_PROVIDERS = {
  openai: {
    defaultModel: 'gpt-5.6-terra',
    models: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']
  },
  anthropic: {
    defaultModel: 'claude-sonnet-5',
    models: ['claude-fable-5', 'claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5-20251001']
  },
  deepseek: {
    defaultModel: 'deepseek-v4-flash',
    models: ['deepseek-v4-pro', 'deepseek-v4-flash']
  }
};

const SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    executive: { type: 'string' },
    actions: { type: 'array', items: { type: 'string' } },
    questions: { type: 'string' },
    raw: { type: 'string' }
  },
  required: ['executive', 'actions', 'questions', 'raw'],
  additionalProperties: false
};

class LlmConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LlmConfigError';
    this.statusCode = 400;
  }
}

class SummaryFormatError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SummaryFormatError';
    this.statusCode = 502;
  }
}

function resolveLlmConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new LlmConfigError('LLM configuration is required for summarization.');
  }

  const provider = config.provider || 'openai';
  const providerConfig = LLM_PROVIDERS[provider];
  if (!providerConfig) {
    throw new LlmConfigError('Unsupported LLM provider.');
  }

  const apiKey = typeof config.apiKey === 'string' ? config.apiKey.trim() : '';
  if (!apiKey) {
    throw new LlmConfigError('LLM API key is required for summarization.');
  }
  if (apiKey.length > 512) {
    throw new LlmConfigError('LLM API key is too long.');
  }

  const model = config.model || providerConfig.defaultModel;
  if (typeof model !== 'string' || !providerConfig.models.includes(model)) {
    throw new LlmConfigError(`Unsupported model for ${provider}.`);
  }

  return { provider, model, apiKey };
}

function parseSummaryText(summaryText) {
  if (typeof summaryText !== 'string' || !summaryText.trim()) {
    throw new SummaryFormatError('The model returned an empty summary.');
  }

  let cleaned = summaryText.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  }

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new SummaryFormatError('The model returned invalid summary JSON.');
  }

  const valid = parsed
    && typeof parsed === 'object'
    && !Array.isArray(parsed)
    && typeof parsed.executive === 'string'
    && Array.isArray(parsed.actions)
    && parsed.actions.every((action) => typeof action === 'string')
    && typeof parsed.questions === 'string'
    && typeof parsed.raw === 'string';

  if (!valid) {
    throw new SummaryFormatError('The model returned an invalid summary structure.');
  }

  return { parsed, cleaned: JSON.stringify(parsed) };
}

module.exports = {
  LLM_PROVIDERS,
  SUMMARY_SCHEMA,
  LlmConfigError,
  SummaryFormatError,
  resolveLlmConfig,
  parseSummaryText
};
