const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { EventEmitter } = require('node:events');

const { NativeSttManager } = require('../stt/sidecar-manager');

class FakeStream extends EventEmitter {
  constructor() {
    super();
    this.destroyed = false;
    this.writable = true;
    this.writes = [];
  }

  write(value) {
    this.writes.push(value);
    return true;
  }
}

class FakeChild extends EventEmitter {
  constructor(pid) {
    super();
    this.pid = pid;
    this.killed = false;
    this.stdin = new FakeStream();
    this.stdout = new FakeStream();
    this.stderr = new FakeStream();
  }

  kill() {
    this.killed = true;
  }

  send(event) {
    this.stdout.emit('data', `${JSON.stringify(event)}\n`);
  }
}

function waitFor(predicate) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      if (predicate()) return resolve();
      if (Date.now() - started > 1000) return reject(new Error('Timed out waiting for test condition'));
      setTimeout(poll, 1);
    };
    poll();
  });
}

function createFixture(context, options = {}) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-manager-test-'));
  context.after(() => fs.rmSync(baseDir, { recursive: true, force: true }));
  const modelDir = path.join(baseDir, 'models');
  fs.mkdirSync(modelDir, { recursive: true });
  const model = path.join(modelDir, 'model.bin');
  fs.writeFileSync(model, 'model');
  fs.writeFileSync(path.join(baseDir, 'whisper-streaming-sidecar.js'), '');

  const installedBackends = ['cuda', 'vulkan', 'cpu'].map((id) => {
    const binaryDir = path.join(baseDir, 'bin', id);
    fs.mkdirSync(binaryDir, { recursive: true });
    const binary = path.join(binaryDir, 'whisper-cli');
    fs.writeFileSync(binary, 'binary');
    return { id, label: id, acceleration: id === 'cpu' ? 'cpu' : 'gpu', binary, requiredFiles: ['whisper-cli'] };
  });
  const children = [];
  const launches = [];
  const killed = [];
  const manager = new NativeSttManager({
    baseDir,
    installedBackends,
    nodeBinary: 'test-node',
    spawn: (command, args, spawnOptions) => {
      const child = new FakeChild(children.length + 1);
      children.push(child);
      launches.push({ command, args, options: spawnOptions, child });
      return child;
    },
    preflight: options.preflight || (() => ({ ok: true })),
    timeouts: { preflightMs: 200, readinessMs: 200 },
    killProcess: (child) => {
      child.killed = true;
      killed.push(child);
    },
    backendPreference: options.backendPreference
  });
  manager.detectBackends();
  return { baseDir, model, installedBackends, manager, children, launches, killed };
}

test('auto preflights backends in cuda, vulkan, cpu order and uses a valid 16 kHz PCM WAV', async (context) => {
  const attempted = [];
  const fixture = createFixture(context, {
    preflight: ({ backend, wavPath }) => {
      attempted.push(backend.id);
      const wav = fs.readFileSync(wavPath);
      assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
      assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
      assert.equal(wav.readUInt16LE(20), 1);
      assert.equal(wav.readUInt16LE(22), 1);
      assert.equal(wav.readUInt32LE(24), 16000);
      assert.ok(wav.readUInt32LE(40) > 0);
      return backend.id === 'cpu' ? { ok: true } : { ok: false, error: `${backend.id} unavailable` };
    }
  });

  const starting = fixture.manager.startSidecar();
  await waitFor(() => fixture.children.length === 1);
  fixture.children[0].send({ type: 'status', status: 'ready', backend: 'cpu', model: fixture.model });
  const result = await starting;

  assert.equal(result.ok, true);
  assert.deepEqual(attempted, ['cuda', 'vulkan', 'cpu']);
  assert.equal(fixture.manager.getStatus().activeBackend, 'cpu');
  assert.deepEqual(fixture.manager.getStatus().backendFailures.map((failure) => failure.backend), ['cuda', 'vulkan']);
});

test('an explicit backend preference never falls back', async (context) => {
  const attempted = [];
  const fixture = createFixture(context, {
    backendPreference: 'vulkan',
    preflight: ({ backend }) => {
      attempted.push(backend.id);
      return { ok: false, error: 'vulkan failed' };
    }
  });

  const result = await fixture.manager.startSidecar();
  assert.equal(result.ok, false);
  assert.deepEqual(attempted, ['vulkan']);
  assert.equal(fixture.children.length, 0);
  assert.equal(fixture.manager.getStatus().backendPreference, 'vulkan');
  assert.equal(fixture.manager.getStatus().phase, 'failed');
});

test('startSidecar waits for the matching ready event', async (context) => {
  const fixture = createFixture(context, { backendPreference: 'cuda' });
  let settled = false;
  const starting = fixture.manager.startSidecar().then((result) => {
    settled = true;
    return result;
  });
  await waitFor(() => fixture.children.length === 1);

  fixture.children[0].send({ type: 'status', status: 'ready', backend: 'cpu', model: fixture.model });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  assert.equal(fixture.manager.getStatus().nativeReady, false);

  fixture.children[0].send({ type: 'status', status: 'ready', backend: 'cuda', model: fixture.model });
  const result = await starting;
  assert.equal(result.ok, true);
  assert.equal(fixture.manager.getStatus().nativeReady, true);
  assert.equal(fixture.manager.getStatus().phase, 'running');
  assert.equal(fixture.launches[0].command, 'test-node');
  assert.equal(fixture.launches[0].options.env.ELECTRON_RUN_AS_NODE, '1');
});

test('replacement isolates stale children and generation-local parser buffers', async (context) => {
  const fixture = createFixture(context, { backendPreference: 'cuda' });
  const transcripts = [];
  fixture.manager.on('transcript', (event) => transcripts.push(event));

  const firstStart = fixture.manager.startSidecar();
  await waitFor(() => fixture.children.length === 1);
  const staleChild = fixture.children[0];
  staleChild.stdout.emit('data', '{"type":"final"');

  const replacementModel = path.join(fixture.baseDir, 'replacement.bin');
  fs.writeFileSync(replacementModel, 'model');
  const replacing = fixture.manager.setModel(replacementModel);
  await waitFor(() => fixture.children.length === 2);
  const currentChild = fixture.children[1];
  staleChild.stdout.emit('data', ',"text":"stale"}\n');
  currentChild.send({ type: 'status', status: 'ready', backend: 'cuda', model: replacementModel });
  currentChild.send({ type: 'final', text: 'current' });

  const [staleResult, replacementResult] = await Promise.all([firstStart, replacing]);
  assert.equal(staleResult.stale, true);
  assert.equal(replacementResult.ok, true);
  assert.equal(staleChild.killed, true);
  assert.deepEqual(transcripts.map((event) => event.text), ['current']);
});

test('model refresh preserves persisted backend preference', async (context) => {
  const fixture = createFixture(context);
  const selected = await fixture.manager.setBackendPreference('vulkan');
  assert.equal(selected.ok, true);

  fixture.manager.refreshModels();
  assert.equal(fixture.manager.getStatus().backendPreference, 'vulkan');
  assert.equal(fixture.manager.getStatus().selectedBackend, 'vulkan');
});

test('reconcile promotes Auto to a newly installed higher-priority backend', async (context) => {
  const fixture = createFixture(context);
  const cudaBinary = fixture.installedBackends.find((backend) => backend.id === 'cuda').binary;
  fs.rmSync(cudaBinary);
  fixture.manager.detectBackends();

  const starting = fixture.manager.startSidecar();
  await waitFor(() => fixture.children.length === 1);
  fixture.children[0].send({ type: 'status', status: 'ready', backend: 'vulkan', model: fixture.model });
  await starting;
  assert.equal(fixture.manager.getStatus().activeBackend, 'vulkan');

  fs.writeFileSync(cudaBinary, 'binary');
  fixture.manager.refreshModels();
  const promoting = fixture.manager.reconcile();
  await waitFor(() => fixture.children.length === 2);
  fixture.children[1].send({ type: 'status', status: 'ready', backend: 'cuda', model: fixture.model });
  const result = await promoting;

  assert.equal(result.ok, true);
  assert.equal(fixture.manager.getStatus().activeBackend, 'cuda');
  assert.equal(fixture.children[0].killed, true);
});

test('auto mode falls forward after two consecutive runtime inference failures', async (context) => {
  const fixture = createFixture(context);
  const starting = fixture.manager.startSidecar();
  await waitFor(() => fixture.children.length === 1);
  fixture.children[0].send({ type: 'status', status: 'ready', backend: 'cuda', model: fixture.model });
  await starting;

  fixture.children[0].send({ type: 'error', inferenceId: 'one', error: 'first inference failed' });
  assert.equal(fixture.manager.getStatus().activeBackend, 'cuda');
  fixture.children[0].send({ type: 'error', inferenceId: 'two', error: 'second inference failed' });
  await waitFor(() => fixture.children.length === 2);
  fixture.children[1].send({ type: 'status', status: 'ready', backend: 'vulkan', model: fixture.model });
  await waitFor(() => fixture.manager.getStatus().activeBackend === 'vulkan');

  const status = fixture.manager.getStatus();
  assert.equal(status.nativeReady, true);
  assert.deepEqual(status.backendFailures.map((failure) => [failure.backend, failure.stage]), [['cuda', 'runtime']]);
  assert.equal(fixture.children[0].killed, true);
});
