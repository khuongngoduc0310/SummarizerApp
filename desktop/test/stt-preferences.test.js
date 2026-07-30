'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { BACKEND_PREFERENCES, createSttPreferences } = require('../stt/stt-preferences');

test('persists every supported preference in versioned JSON', async (context) => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stt-preferences-'));
  context.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
  const store = createSttPreferences(path.join(directory, 'nested', 'preferences.json'));

  for (const backend of BACKEND_PREFERENCES) {
    assert.deepEqual(await store.save(backend), { version: 1, backend });
    assert.deepEqual(await store.load(), { version: 1, backend });
  }
});

test('recovers from absent, malformed, and unsupported preference files', async (context) => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stt-preferences-'));
  context.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'preferences.json');
  const store = createSttPreferences(filePath);
  assert.deepEqual(await store.load(), { version: 1, backend: 'auto' });
  await fs.promises.writeFile(filePath, '{broken');
  assert.deepEqual(await store.load(), { version: 1, backend: 'auto' });
  await fs.promises.writeFile(filePath, JSON.stringify({ version: 2, backend: 'cuda' }));
  assert.deepEqual(await store.load(), { version: 1, backend: 'auto' });
  await assert.rejects(store.save('metal'), /Invalid STT backend preference/);
});
