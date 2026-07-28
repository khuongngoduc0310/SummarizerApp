import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getActiveApiKey,
  getSelectedModelId,
  LLM_PROVIDERS,
  normalizeLlmConfig
} from '../src/config/llmModels.js';

test('creates balanced defaults for a new configuration', () => {
  const config = normalizeLlmConfig(null);

  assert.equal(config.provider, 'openai');
  assert.equal(config.models.openai, LLM_PROVIDERS.openai.defaultModel);
  assert.equal(config.models.anthropic, LLM_PROVIDERS.anthropic.defaultModel);
  assert.equal(config.models.deepseek, LLM_PROVIDERS.deepseek.defaultModel);
});

test('migrates a legacy single key to its selected provider', () => {
  const config = normalizeLlmConfig({ provider: 'anthropic', apiKey: 'legacy-key' });

  assert.equal(config.apiKeys.anthropic, 'legacy-key');
  assert.equal(config.apiKeys.openai, '');
  assert.equal(getActiveApiKey(config), 'legacy-key');
});

test('retains independent valid models and provider keys', () => {
  const config = normalizeLlmConfig({
    provider: 'deepseek',
    models: {
      openai: 'gpt-5.6-sol',
      anthropic: 'claude-opus-5',
      deepseek: 'deepseek-v4-pro'
    },
    apiKeys: {
      openai: 'openai-key',
      anthropic: 'anthropic-key',
      deepseek: 'deepseek-key'
    }
  });

  assert.equal(getSelectedModelId(config), 'deepseek-v4-pro');
  assert.equal(getActiveApiKey(config), 'deepseek-key');
  assert.equal(config.apiKeys.openai, 'openai-key');
});

test('replaces stale model IDs with provider defaults', () => {
  const config = normalizeLlmConfig({
    provider: 'openai',
    models: { openai: 'retired-model' }
  });

  assert.equal(getSelectedModelId(config), LLM_PROVIDERS.openai.defaultModel);
});
