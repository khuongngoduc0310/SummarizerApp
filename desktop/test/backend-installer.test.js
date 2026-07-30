'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const test = require('node:test');
const yazl = require('yazl');

const { WHISPER_CPP_CUDA_11_8_WINDOWS_X64: catalogBackend } = require('../stt/backend-catalog');
const {
  createBackendInstaller,
  planArchiveEntries,
  validateArchivePath,
  validateDownloadUrl
} = require('../stt/backend-installer');

function entry(fileName, uncompressedSize = 1, externalFileAttributes = 0) {
  return { fileName, uncompressedSize, externalFileAttributes, compressionMethod: 8, generalPurposeBitFlag: 0 };
}

function fixtureBackend(overrides = {}) {
  return {
    archivePaths: ['Release/whisper-cli.exe', 'Release/ggml.dll'],
    selectiveExtraction: true,
    limits: { maxEntries: 10, maxEntryUncompressedSize: 10, maxTotalUncompressedSize: 20 },
    ...overrides
  };
}

function createZip(files) {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    const chunks = [];
    zip.outputStream.on('data', (chunk) => chunks.push(chunk));
    zip.outputStream.on('error', reject);
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
    for (const [name, contents] of Object.entries(files)) zip.addBuffer(Buffer.from(contents), name);
    zip.end();
  });
}

function requestFromBuffer(buffer) {
  return (_url, _options, callback) => {
    const request = new EventEmitter();
    request.setTimeout = () => {};
    request.end = () => {
      queueMicrotask(() => {
        const response = Readable.from(buffer);
        response.statusCode = 200;
        response.headers = { 'content-length': String(buffer.length) };
        callback(response);
      });
    };
    request.destroy = (error) => request.emit('error', error);
    return request;
  };
}

test('rejects traversal, absolute, UNC, ADS, reserved, and non-portable paths', () => {
  for (const unsafe of [
    '../escape.dll', '/absolute.dll', '//server/share.dll', 'C:/absolute.dll',
    'Release\\escape.dll', 'Release/file.dll:stream', 'Release/CON',
    'Release/com1.txt', 'Release/trailing.', 'Release/trailing ', 'Release/a?.dll'
  ]) {
    assert.throws(() => validateArchivePath(unsafe), /archive|Windows|stream|Absolute|Reserved/i, unsafe);
  }
  assert.equal(validateArchivePath('Release/whisper-cli.exe'), 'Release/whisper-cli.exe');
});

test('rejects duplicates, case collisions, missing files, and uncompressed bombs', () => {
  const backend = fixtureBackend();
  assert.throws(() => planArchiveEntries([
    entry('Release/whisper-cli.exe'), entry('Release/whisper-cli.exe'), entry('Release/ggml.dll')
  ], backend), /Duplicate/);
  assert.throws(() => planArchiveEntries([
    entry('Release/whisper-cli.exe'), entry('release/WHISPER-CLI.EXE'), entry('Release/ggml.dll')
  ], backend), /Case-colliding/);
  assert.throws(() => planArchiveEntries([entry('Release/whisper-cli.exe')], backend), /missing required/);
  assert.throws(() => planArchiveEntries([
    entry('Release/whisper-cli.exe', 11), entry('Release/ggml.dll')
  ], backend), /uncompressed limit/);
  assert.throws(() => planArchiveEntries([
    entry('Release/whisper-cli.exe', 10), entry('Release/ggml.dll', 10), entry('Release/extra.dll', 1)
  ], backend), /total uncompressed limit/);
  assert.throws(() => planArchiveEntries([
    entry('Release/whisper-cli.exe', 1, 0x10), entry('Release/ggml.dll')
  ], backend), /is a directory/);
  assert.throws(() => planArchiveEntries(new Array(11).fill(entry('Release/extra.dll')), backend), /entry limit/);
  assert.throws(() => planArchiveEntries([
    { ...entry('Release/whisper-cli.exe'), generalPurposeBitFlag: 1 }, entry('Release/ggml.dll')
  ], backend), /Encrypted/);
  assert.throws(() => planArchiveEntries([
    { ...entry('Release/whisper-cli.exe'), compressionMethod: 99 }, entry('Release/ggml.dll')
  ], backend), /compression/);
});

test('selective extraction skips only safe unexpected entries when explicitly enabled', () => {
  const entries = [
    entry('Release/whisper-cli.exe', 2),
    entry('Release/extra-tool.exe', 3),
    entry('Release/ggml.dll', 4)
  ];
  const plan = planArchiveEntries(entries, fixtureBackend());
  assert.deepEqual(plan.selected.map((item) => item.fileName), [
    'Release/whisper-cli.exe', 'Release/ggml.dll'
  ]);
  assert.equal(plan.totalUncompressedSize, 9);
  assert.throws(() => planArchiveEntries(entries, fixtureBackend({ selectiveExtraction: false })), /Unexpected/);
  assert.throws(() => planArchiveEntries([
    ...entries, entry('../unsafe-but-unselected.dll')
  ], fixtureBackend()), /traversal/);
});

test('allows only HTTPS catalog hosts without credentials or custom ports', () => {
  const hosts = catalogBackend.allowedHttpsHosts;
  assert.equal(validateDownloadUrl(catalogBackend.asset.url, hosts).hostname, 'github.com');
  assert.equal(validateDownloadUrl('https://release-assets.githubusercontent.com/object', hosts).hostname,
    'release-assets.githubusercontent.com');
  assert.throws(() => validateDownloadUrl('http://github.com/file.zip', hosts), /Disallowed/);
  assert.throws(() => validateDownloadUrl('https://github.com.evil.test/file.zip', hosts), /host/);
  assert.throws(() => validateDownloadUrl('https://user@github.com/file.zip', hosts), /Disallowed/);
  assert.throws(() => validateDownloadUrl('https://github.com:444/file.zip', hosts), /Disallowed/);
});

test('installer status and removal are constrained to known catalog IDs', async (context) => {
  const installRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'backend-installer-'));
  context.after(() => fs.promises.rm(installRoot, { recursive: true, force: true }));
  const installer = createBackendInstaller({ installRoot });
  await assert.rejects(installer.status('../unknown'), /Unknown backend catalog ID/);
  await assert.rejects(installer.remove('../unknown'), /Unknown backend catalog ID/);
  const statuses = await installer.list();
  assert.equal(statuses.length, 1);
  assert.equal(statuses[0].id, catalogBackend.id);
  assert.equal(statuses[0].installed, false);
  assert.deepEqual(await installer.remove(catalogBackend.id), { id: catalogBackend.id, removed: true });
});

test('downloads, verifies, selectively extracts, validates, and atomically activates a backend', async (context) => {
  const installRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'backend-installer-full-'));
  context.after(() => fs.promises.rm(installRoot, { recursive: true, force: true }));
  const files = {
    'Release/whisper-cli.exe': 'cli',
    'Release/ggml.dll': 'ggml',
    'Release/unrelated-tool.exe': 'skip'
  };
  const archive = await createZip(files);
  const installedSize = Buffer.byteLength(files['Release/whisper-cli.exe']) + Buffer.byteLength(files['Release/ggml.dll']);
  const backend = {
    id: 'fixture',
    version: 'v1',
    commit: 'fixture-commit',
    archivePrefix: 'Release/',
    archivePaths: ['Release/whisper-cli.exe', 'Release/ggml.dll'],
    requiredFiles: ['whisper-cli.exe', 'ggml.dll'],
    installedSize,
    requiredFreeSpace: 1,
    selectiveExtraction: true,
    allowedHttpsHosts: ['github.com'],
    limits: { maxEntries: 10, maxEntryUncompressedSize: 100, maxTotalUncompressedSize: 100 },
    asset: {
      id: 1,
      name: 'fixture.zip',
      url: 'https://github.com/fixture.zip',
      size: archive.length,
      sha256: crypto.createHash('sha256').update(archive).digest('hex')
    }
  };
  let validated = false;
  const installer = createBackendInstaller({
    installRoot,
    catalog: { fixture: backend },
    request: requestFromBuffer(archive),
    getFreeSpace: async () => 1000,
    validator: async ({ installPath }) => {
      validated = true;
      assert.equal(await fs.promises.readFile(path.join(installPath, 'whisper-cli.exe'), 'utf8'), 'cli');
    }
  });

  const result = await installer.install('fixture');
  assert.equal(validated, true);
  assert.equal(await fs.promises.readFile(path.join(result.installPath, 'ggml.dll'), 'utf8'), 'ggml');
  await assert.rejects(fs.promises.access(path.join(result.installPath, 'unrelated-tool.exe')));
  assert.equal((await installer.status('fixture')).installed, true);

  const manifestPath = path.join(result.installPath, 'install-manifest.json');
  const invalidManifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8'));
  invalidManifest.installedSize = 0;
  await fs.promises.writeFile(manifestPath, JSON.stringify(invalidManifest));
  assert.equal((await installer.status('fixture')).installed, false);
  await installer.install('fixture');
  assert.equal((await installer.status('fixture')).installed, true);
});

test('rejects hash mismatches and insufficient staging space without activating files', async (context) => {
  const installRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'backend-installer-reject-'));
  context.after(() => fs.promises.rm(installRoot, { recursive: true, force: true }));
  const archive = await createZip({ 'Release/whisper-cli.exe': 'cli' });
  const backend = {
    id: 'fixture', version: 'v1', commit: 'fixture', archivePrefix: 'Release/',
    archivePaths: ['Release/whisper-cli.exe'], requiredFiles: ['whisper-cli.exe'],
    installedSize: 3, requiredFreeSpace: 10, selectiveExtraction: true,
    allowedHttpsHosts: ['github.com'],
    limits: { maxEntries: 10, maxEntryUncompressedSize: 100, maxTotalUncompressedSize: 100 },
    asset: { id: 1, name: 'fixture.zip', url: 'https://github.com/fixture.zip', size: archive.length, sha256: '0'.repeat(64) }
  };
  const noSpace = createBackendInstaller({
    installRoot, catalog: { fixture: backend }, request: requestFromBuffer(archive), getFreeSpace: async () => 0
  });
  await assert.rejects(noSpace.install('fixture'), /Insufficient disk space/);

  const badHash = createBackendInstaller({
    installRoot, catalog: { fixture: backend }, request: requestFromBuffer(archive), getFreeSpace: async () => 100
  });
  await assert.rejects(badHash.install('fixture'), /SHA256 mismatch/);
  assert.equal((await badHash.status('fixture')).installed, false);
});
