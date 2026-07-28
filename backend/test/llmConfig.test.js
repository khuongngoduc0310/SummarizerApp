const test = require('node:test');
const assert = require('node:assert/strict');
const {
  LLM_PROVIDERS,
  LlmConfigError,
  SummaryFormatError,
  resolveLlmConfig,
  parseSummaryText
} = require('../llmConfig');

test('accepts every supported provider and model pair', () => {
  Object.entries(LLM_PROVIDERS).forEach(([provider, config]) => {
    config.models.forEach((model) => {
      assert.deepEqual(resolveLlmConfig({ provider, model, apiKey: ' test-key ' }), {
        provider,
        model,
        apiKey: 'test-key'
      });
    });
  });
});

test('uses the provider default when an older client omits the model', () => {
  Object.entries(LLM_PROVIDERS).forEach(([provider, config]) => {
    assert.equal(resolveLlmConfig({ provider, apiKey: 'test-key' }).model, config.defaultModel);
  });
});

test('rejects unknown providers, models, and blank keys', () => {
  assert.throws(() => resolveLlmConfig({ provider: 'unknown', apiKey: 'key' }), LlmConfigError);
  assert.throws(() => resolveLlmConfig({ provider: 'openai', model: 'unknown', apiKey: 'key' }), LlmConfigError);
  assert.throws(() => resolveLlmConfig({ provider: 'openai', apiKey: '   ' }), LlmConfigError);
});

test('parses and normalizes a valid summary', () => {
  const summary = {
    executive: 'Overview',
    actions: ['Follow up'],
    questions: 'What is next?',
    raw: '## Notes\nDetails'
  };
  const result = parseSummaryText(`\n\`\`\`json\n${JSON.stringify(summary)}\n\`\`\`\n`);

  assert.deepEqual(result.parsed, summary);
  assert.equal(result.cleaned, JSON.stringify(summary));
});

test('rejects empty, malformed, and structurally invalid summaries', () => {
  assert.throws(() => parseSummaryText(''), SummaryFormatError);
  assert.throws(() => parseSummaryText('{invalid'), SummaryFormatError);
  assert.throws(() => parseSummaryText(JSON.stringify({ executive: 'Only one field' })), SummaryFormatError);
});
