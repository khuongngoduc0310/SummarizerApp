const test = require('node:test');
const assert = require('node:assert/strict');
const { createSummaryFeature } = require('../features/summary');
const { SummaryFormatError } = require('../llmConfig');

function mockResponse(json) {
  const body = JSON.stringify(json);
  return {
    statusCode: 200,
    _body: null,
    status(code) { this.statusCode = code; return this; },
    json(data) { this._body = data; return this; }
  };
}

function mockPrisma(meeting, segments) {
  const calls = { findMany: null, findUnique: null, create: null };
  return {
    _calls: calls,
    meeting: {
      findUnique: async (args) => {
        calls.findUnique = args;
        return meeting;
      }
    },
    transcriptSegment: {
      findMany: async (args) => {
        calls.findMany = args;
        return segments;
      }
    },
    summary: {
      create: async (args) => {
        calls.create = args;
        return { id: 'summary-1', ...args.data };
      }
    }
  };
}

test('rejects invalid meeting ID format', async () => {
  const handler = createSummaryFeature({
    prisma: mockPrisma(),
    getOpenAI: () => ({}),
    getAnthropic: () => ({})
  });
  const req = { params: { id: 'not-a-uuid' }, body: {}, query: {} };
  const res = mockResponse();

  await handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.match(res._body.error, /Invalid meeting ID format/);
});

test('rejects invalid userId', async () => {
  const handler = createSummaryFeature({
    prisma: mockPrisma(),
    getOpenAI: () => ({}),
    getAnthropic: () => ({})
  });
  const req = {
    params: { id: '123e4567-e89b-42d3-a456-426614174000' },
    body: { userId: '', llmConfig: {} },
    query: {}
  };
  const res = mockResponse();

  await handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.match(res._body.error, /userId must be a non-empty string/);
});

test('rejects invalid llmConfig', async () => {
  const handler = createSummaryFeature({
    prisma: mockPrisma(),
    getOpenAI: () => ({}),
    getAnthropic: () => ({})
  });
  const req = {
    params: { id: '123e4567-e89b-42d3-a456-426614174000' },
    body: { userId: 'user-1', llmConfig: { provider: 'unknown', apiKey: 'key' } },
    query: {}
  };
  const res = mockResponse();

  await handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.match(res._body.error, /Unsupported LLM provider/);
});

test('returns 404 when meeting is not found', async () => {
  const handler = createSummaryFeature({
    prisma: mockPrisma(null, []),
    getOpenAI: () => ({}),
    getAnthropic: () => ({})
  });
  const req = {
    params: { id: '123e4567-e89b-42d3-a456-426614174000' },
    body: { userId: 'user-1', llmConfig: { provider: 'openai', model: 'gpt-5.6-terra', apiKey: 'sk-test' } },
    query: {}
  };
  const res = mockResponse();

  await handler(req, res);

  assert.equal(res.statusCode, 404);
  assert.match(res._body.error, /Meeting not found/);
});

test('returns 400 when no transcript segments exist', async () => {
  const handler = createSummaryFeature({
    prisma: mockPrisma({
      id: '123e4567-e89b-42d3-a456-426614174000',
      startedAt: new Date('2026-01-01T00:00:00Z'),
      sessionStartedAt: new Date('2026-01-01T01:00:00Z')
    }, []),
    getOpenAI: () => ({}),
    getAnthropic: () => ({})
  });
  const req = {
    params: { id: '123e4567-e89b-42d3-a456-426614174000' },
    body: { userId: 'user-1', llmConfig: { provider: 'openai', model: 'gpt-5.6-terra', apiKey: 'sk-test' } },
    query: {}
  };
  const res = mockResponse();

  await handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.match(res._body.error, /No transcript segments found/);
});

test('returns 502 on malformed provider output', async () => {
  const handler = createSummaryFeature({
    prisma: mockPrisma({
      id: '123e4567-e89b-42d3-a456-426614174000',
      startedAt: new Date('2026-01-01T00:00:00Z'),
      sessionStartedAt: new Date('2026-01-01T01:00:00Z')
    }, [
      {
        id: 'seg-1',
        text: 'Hello world',
        start: 0,
        end: 2,
        speakerId: 'speaker-1',
        sessionStartedAt: new Date('2026-01-01T01:00:00Z'),
        createdAt: new Date('2026-01-01T01:00:02Z'),
        transcript: { id: 'tx-1', owner: { displayName: 'Speaker' } }
      }
    ]),
    getOpenAI: () => ({
      responses: {
        create: async () => ({
          status: 'completed',
          output_text: '',
          usage: {}
        })
      }
    }),
    getAnthropic: () => ({})
  });
  const req = {
    params: { id: '123e4567-e89b-42d3-a456-426614174000' },
    body: { userId: 'user-1', llmConfig: { provider: 'openai', model: 'gpt-5.6-terra', apiKey: 'sk-test' } },
    query: {}
  };
  const res = mockResponse();

  await handler(req, res);

  assert.equal(res.statusCode, 502);
  assert.match(res._body.error, /returned an empty summary/);
});

test('handles OpenAI incomplete responses as format errors', async () => {
  const handler = createSummaryFeature({
    prisma: mockPrisma({
      id: '123e4567-e89b-42d3-a456-426614174000',
      startedAt: new Date('2026-01-01T00:00:00Z'),
      sessionStartedAt: new Date('2026-01-01T01:00:00Z')
    }, [
      {
        id: 'seg-1',
        text: 'Hello',
        start: 0,
        end: 1,
        speakerId: 'speaker-1',
        sessionStartedAt: new Date('2026-01-01T01:00:00Z'),
        createdAt: new Date('2026-01-01T01:00:01Z'),
        transcript: { id: 'tx-1', owner: { displayName: 'Speaker' } }
      }
    ]),
    getOpenAI: () => ({
      responses: {
        create: async () => ({
          status: 'incomplete',
          output_text: '',
          usage: {}
        })
      }
    }),
    getAnthropic: () => ({})
  });
  const req = {
    params: { id: '123e4567-e89b-42d3-a456-426614174000' },
    body: { userId: 'user-1', llmConfig: { provider: 'openai', model: 'gpt-5.6-terra', apiKey: 'sk-test' } },
    query: {}
  };
  const res = mockResponse();

  await handler(req, res);

  assert.equal(res.statusCode, 502);
  assert.match(res._body.error, /incomplete/);
});

test('returns 502 on provider SDK failures', async () => {
  const handler = createSummaryFeature({
    prisma: mockPrisma({
      id: '123e4567-e89b-42d3-a456-426614174000',
      startedAt: new Date('2026-01-01T00:00:00Z'),
      sessionStartedAt: new Date('2026-01-01T01:00:00Z')
    }, [
      {
        id: 'seg-1',
        text: 'Hello',
        start: 0,
        end: 1,
        speakerId: 'speaker-1',
        sessionStartedAt: new Date('2026-01-01T01:00:00Z'),
        createdAt: new Date('2026-01-01T01:00:01Z'),
        transcript: { id: 'tx-1', owner: { displayName: 'Speaker' } }
      }
    ]),
    getOpenAI: () => ({
      responses: {
        create: async () => { throw new Error('API connection refused'); }
      }
    }),
    getAnthropic: () => ({})
  });
  const req = {
    params: { id: '123e4567-e89b-42d3-a456-426614174000' },
    body: { userId: 'user-1', llmConfig: { provider: 'openai', model: 'gpt-5.6-terra', apiKey: 'sk-test' } },
    query: {}
  };
  const res = mockResponse();

  await handler(req, res);

  assert.equal(res.statusCode, 502);
  assert.match(res._body.error, /Summary generation failed/);
});

test('returns successful summary with _meta fields (OpenAI path)', async () => {
  const summaryData = {
    executive: 'Test executive summary',
    actions: ['Action item 1', 'Action item 2'],
    questions: 'What next?',
    raw: '## Detailed notes'
  };
  const prisma = mockPrisma({
    id: '123e4567-e89b-42d3-a456-426614174000',
    startedAt: new Date('2026-01-01T00:00:00Z'),
    sessionStartedAt: new Date('2026-01-01T01:00:00Z')
  }, [
    {
      id: 'seg-1',
      text: 'Hello world, this is a test meeting.',
      start: 0,
      end: 2,
      speakerId: 'speaker-1',
      sessionStartedAt: new Date('2026-01-01T01:00:00Z'),
      createdAt: new Date('2026-01-01T01:00:02Z'),
      transcript: { id: 'tx-1', owner: { displayName: 'Speaker' } }
    }
  ]);

  const handler = createSummaryFeature({
    prisma,
    getOpenAI: () => ({
      responses: {
        create: async () => ({
          status: 'completed',
          output_text: JSON.stringify(summaryData),
          usage: { total_tokens: 100 }
        })
      }
    }),
    getAnthropic: () => ({})
  });

  const req = {
    params: { id: '123e4567-e89b-42d3-a456-426614174000' },
    body: { userId: 'user-1', llmConfig: { provider: 'openai', model: 'gpt-5.6-terra', apiKey: 'sk-test' } },
    query: {}
  };
  const res = mockResponse();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res._body.executive, 'Test executive summary');
  assert.deepEqual(res._body.actions, ['Action item 1', 'Action item 2']);
  assert.equal(res._body.questions, 'What next?');
  assert.equal(res._body.raw, '## Detailed notes');
  assert.deepEqual(res._body._meta, {
    type: 'full',
    segmentCount: 1,
    droppedCount: 0,
    provider: 'openai',
    model: 'gpt-5.6-terra'
  });

  // Verify summary was persisted with correct data
  assert.ok(prisma._calls.create);
  assert.equal(prisma._calls.create.data.meetingId, '123e4567-e89b-42d3-a456-426614174000');
  assert.equal(prisma._calls.create.data.transcriptId, 'tx-1');
  assert.equal(prisma._calls.create.data.requestedById, 'user-1');
  assert.equal(prisma._calls.create.data.provider, 'openai');
  assert.equal(prisma._calls.create.data.model, 'gpt-5.6-terra');
  assert.equal(prisma._calls.create.data.type, 'full');
  assert.equal(prisma._calls.create.data.timeRangeStart, null);
  assert.equal(prisma._calls.create.data.timeRangeEnd, null);
});

test('returns successful rolling summary', async () => {
  const summaryData = {
    executive: 'Rolling summary',
    actions: ['Task 1'],
    questions: 'None',
    raw: '# Notes'
  };
  const prisma = mockPrisma({
    id: '123e4567-e89b-42d3-a456-426614174000',
    startedAt: new Date(Date.now() - 60 * 60 * 1000), // 1 hour ago
    sessionStartedAt: new Date(Date.now() - 30 * 60 * 1000) // 30 minutes ago
  }, [
    {
      id: 'seg-1',
      text: 'Recent discussion',
      start: 0,
      end: 2,
      speakerId: 'speaker-1',
      sessionStartedAt: new Date(Date.now() - 30 * 60 * 1000),
      createdAt: new Date(Date.now() - 10 * 60 * 1000),
      transcript: { id: 'tx-1', owner: { displayName: 'Speaker' } }
    }
  ]);

  const handler = createSummaryFeature({
    prisma,
    getOpenAI: () => ({
      responses: {
        create: async () => ({
          status: 'completed',
          output_text: JSON.stringify(summaryData),
          usage: {}
        })
      }
    }),
    getAnthropic: () => ({})
  });

  const req = {
    params: { id: '123e4567-e89b-42d3-a456-426614174000' },
    body: { userId: 'user-1', llmConfig: { provider: 'openai', model: 'gpt-5.6-terra', apiKey: 'sk-test' } },
    query: { minutes: '15' }
  };
  const res = mockResponse();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res._body._meta.type, 'rolling');
  assert.ok(res._body._meta.segmentCount > 0);
  assert.equal(res._body._meta.provider, 'openai');
  assert.equal(res._body._meta.model, 'gpt-5.6-terra');

  // Verify persistence
  assert.equal(prisma._calls.create.data.type, 'rolling');
  assert.notEqual(prisma._calls.create.data.timeRangeStart, null);
  assert.notEqual(prisma._calls.create.data.timeRangeEnd, null);
});

test('supports Anthropic provider path', async () => {
  const summaryData = {
    executive: 'Anthropic summary',
    actions: ['Action'],
    questions: 'Q1',
    raw: '# Anthropic'
  };
  const prisma = mockPrisma({
    id: '123e4567-e89b-42d3-a456-426614174000',
    startedAt: new Date('2026-01-01T00:00:00Z'),
    sessionStartedAt: new Date('2026-01-01T01:00:00Z')
  }, [
    {
      id: 'seg-1',
      text: 'Test content for anthropic',
      start: 0,
      end: 1,
      speakerId: 'speaker-1',
      sessionStartedAt: new Date('2026-01-01T01:00:00Z'),
      createdAt: new Date('2026-01-01T01:00:01Z'),
      transcript: { id: 'tx-1', owner: { displayName: 'Speaker' } }
    }
  ]);

  const handler = createSummaryFeature({
    prisma,
    getOpenAI: () => ({}),
    getAnthropic: () => ({
      messages: {
        create: async () => ({
          content: [{ type: 'text', text: JSON.stringify(summaryData) }],
          usage: { input_tokens: 50, output_tokens: 30 }
        })
      }
    })
  });

  const req = {
    params: { id: '123e4567-e89b-42d3-a456-426614174000' },
    body: { userId: 'user-1', llmConfig: { provider: 'anthropic', model: 'claude-sonnet-5', apiKey: 'sk-ant-test' } },
    query: {}
  };
  const res = mockResponse();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res._body.executive, 'Anthropic summary');
  assert.equal(res._body._meta.provider, 'anthropic');
  assert.equal(res._body._meta.model, 'claude-sonnet-5');
  assert.equal(prisma._calls.create.data.provider, 'anthropic');
});

test('supports DeepSeek provider path', async () => {
  const summaryData = {
    executive: 'DeepSeek summary',
    actions: ['Task'],
    questions: 'Q',
    raw: '# DeepSeek'
  };
  const prisma = mockPrisma({
    id: '123e4567-e89b-42d3-a456-426614174000',
    startedAt: new Date('2026-01-01T00:00:00Z'),
    sessionStartedAt: new Date('2026-01-01T01:00:00Z')
  }, [
    {
      id: 'seg-1',
      text: 'Test content for deepseek',
      start: 0,
      end: 1,
      speakerId: 'speaker-1',
      sessionStartedAt: new Date('2026-01-01T01:00:00Z'),
      createdAt: new Date('2026-01-01T01:00:01Z'),
      transcript: { id: 'tx-1', owner: { displayName: 'Speaker' } }
    }
  ]);

  const handler = createSummaryFeature({
    prisma,
    getOpenAI: () => ({
      chat: {
        completions: {
          create: async () => ({
            choices: [{ message: { content: JSON.stringify(summaryData) } }],
            usage: { total_tokens: 80 }
          })
        }
      }
    }),
    getAnthropic: () => ({})
  });

  const req = {
    params: { id: '123e4567-e89b-42d3-a456-426614174000' },
    body: { userId: 'user-1', llmConfig: { provider: 'deepseek', model: 'deepseek-v4-flash', apiKey: 'sk-ds-test' } },
    query: {}
  };
  const res = mockResponse();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res._body.executive, 'DeepSeek summary');
  assert.equal(res._body._meta.provider, 'deepseek');
  assert.equal(res._body._meta.model, 'deepseek-v4-flash');
  assert.equal(prisma._calls.create.data.provider, 'deepseek');
});

test('uses sessionStartedAt fallback when building where clause', async () => {
  const prisma = mockPrisma({
    id: '123e4567-e89b-42d3-a456-426614174000',
    startedAt: new Date('2026-01-01T00:00:00Z'),
    sessionStartedAt: null
  }, [
    {
      id: 'seg-1',
      text: 'Hello world',
      start: 0,
      end: 2,
      speakerId: 'speaker-1',
      sessionStartedAt: new Date('2026-01-01T00:00:00Z'),
      createdAt: new Date('2026-01-01T00:00:02Z'),
      transcript: { id: 'tx-1', owner: { displayName: 'Speaker' } }
    }
  ]);

  const handler = createSummaryFeature({
    prisma,
    getOpenAI: () => ({
      responses: {
        create: async () => ({
          status: 'completed',
          output_text: JSON.stringify({
            executive: 'OK', actions: [], questions: '', raw: ''
          }),
          usage: {}
        })
      }
    }),
    getAnthropic: () => ({})
  });

  const req = {
    params: { id: '123e4567-e89b-42d3-a456-426614174000' },
    body: { userId: 'user-1', llmConfig: { provider: 'openai', model: 'gpt-5.6-terra', apiKey: 'sk-test' } },
    query: {}
  };
  const res = mockResponse();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  // The where clause should use startedAt since sessionStartedAt is null
  const findManyWhere = prisma._calls.findMany.where;
  assert.ok(findManyWhere.sessionStartedAt);
});
