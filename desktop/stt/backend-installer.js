'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const yauzl = require('yauzl');

const { BACKEND_CATALOG } = require('./backend-catalog');

const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

function abortError() {
  const error = new Error('Operation aborted');
  error.name = 'AbortError';
  error.code = 'ABORT_ERR';
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

function validateArchivePath(fileName) {
  if (typeof fileName !== 'string' || fileName.length === 0 || fileName.includes('\\')) {
    throw new Error(`Unsafe archive path: ${String(fileName)}`);
  }
  if (fileName.startsWith('/') || fileName.startsWith('//') || /^[A-Za-z]:/.test(fileName)) {
    throw new Error(`Absolute archive path is not allowed: ${fileName}`);
  }

  const isDirectory = fileName.endsWith('/');
  const parts = fileName.split('/');
  if (isDirectory) parts.pop();
  if (parts.length === 0) throw new Error(`Unsafe archive path: ${fileName}`);

  for (const part of parts) {
    if (!part || part === '.' || part === '..') throw new Error(`Archive traversal is not allowed: ${fileName}`);
    if (part.includes(':')) throw new Error(`NTFS alternate data stream path is not allowed: ${fileName}`);
    if (/[<>"|?*\u0000-\u001f]/.test(part) || /[. ]$/.test(part)) {
      throw new Error(`Non-portable Windows archive path: ${fileName}`);
    }
    if (WINDOWS_RESERVED_NAME.test(part)) throw new Error(`Reserved Windows archive path: ${fileName}`);
  }
  return fileName;
}

function validateDownloadUrl(url, allowedHosts) {
  const parsed = url instanceof URL ? url : new URL(url);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) {
    throw new Error(`Disallowed download URL: ${parsed.href}`);
  }
  if (!allowedHosts.includes(parsed.hostname.toLowerCase())) {
    throw new Error(`Disallowed download host: ${parsed.hostname}`);
  }
  return parsed;
}

function isDirectoryEntry(entry) {
  return entry.fileName.endsWith('/') || (entry.externalFileAttributes & 0x10) !== 0 ||
    ((entry.externalFileAttributes >>> 16) & 0xf000) === 0x4000;
}

function isSymlinkEntry(entry) {
  return ((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000;
}

function planArchiveEntries(entries, backend) {
  if (!Array.isArray(entries) || entries.length > backend.limits.maxEntries) {
    throw new Error('Archive exceeds central-directory entry limit');
  }
  const allowed = new Set(backend.archivePaths);
  const selected = [];
  const seenExact = new Set();
  const seenCaseInsensitive = new Map();
  let totalUncompressedSize = 0;

  for (const entry of entries) {
    validateArchivePath(entry.fileName);
    if ((entry.generalPurposeBitFlag & 0x1) !== 0) {
      throw new Error(`Encrypted archive entries are not allowed: ${entry.fileName}`);
    }
    if (![0, 8].includes(entry.compressionMethod)) {
      throw new Error(`Unsupported ZIP compression method for ${entry.fileName}`);
    }
    const folded = entry.fileName.toLowerCase();
    if (seenExact.has(entry.fileName)) throw new Error(`Duplicate archive entry: ${entry.fileName}`);
    if (seenCaseInsensitive.has(folded)) {
      throw new Error(`Case-colliding archive entries: ${seenCaseInsensitive.get(folded)} and ${entry.fileName}`);
    }
    seenExact.add(entry.fileName);
    seenCaseInsensitive.set(folded, entry.fileName);

    if (isSymlinkEntry(entry)) throw new Error(`Archive links are not allowed: ${entry.fileName}`);
    if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0) {
      throw new Error(`Invalid uncompressed size for ${entry.fileName}`);
    }
    if (entry.uncompressedSize > backend.limits.maxEntryUncompressedSize) {
      throw new Error(`Archive entry exceeds uncompressed limit: ${entry.fileName}`);
    }
    totalUncompressedSize += entry.uncompressedSize;
    if (totalUncompressedSize > backend.limits.maxTotalUncompressedSize) {
      throw new Error('Archive exceeds total uncompressed limit');
    }

    if (!allowed.has(entry.fileName)) {
      if (!backend.selectiveExtraction) throw new Error(`Unexpected archive entry: ${entry.fileName}`);
      continue;
    }
    if (isDirectoryEntry(entry)) throw new Error(`Expected runtime file is a directory: ${entry.fileName}`);
    selected.push(entry);
  }

  const selectedNames = new Set(selected.map((entry) => entry.fileName));
  const missing = backend.archivePaths.filter((fileName) => !selectedNames.has(fileName));
  if (missing.length) throw new Error(`Archive is missing required entries: ${missing.join(', ')}`);
  return { selected, totalUncompressedSize };
}

function openZip(zipPath) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true }, (error, zipFile) => {
      if (error) reject(error);
      else resolve(zipFile);
    });
  });
}

async function readCentralDirectory(zipPath, signal) {
  throwIfAborted(signal);
  const zipFile = await openZip(zipPath);
  if (signal?.aborted) {
    zipFile.close();
    throw abortError();
  }
  return new Promise((resolve, reject) => {
    const entries = [];
    const fail = (error) => {
      zipFile.close();
      reject(error);
    };
    const onAbort = () => fail(abortError());
    signal?.addEventListener('abort', onAbort, { once: true });
    zipFile.on('error', fail);
    zipFile.on('entry', (entry) => {
      entries.push(entry);
      zipFile.readEntry();
    });
    zipFile.on('end', () => {
      signal?.removeEventListener('abort', onAbort);
      resolve(entries);
    });
    zipFile.readEntry();
  });
}

function openEntryStream(zipFile, entry) {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (error, stream) => error ? reject(error) : resolve(stream));
  });
}

async function extractSelectedEntries(zipPath, destination, backend, signal, reportProgress) {
  const zipFile = await openZip(zipPath);
  if (signal?.aborted) {
    zipFile.close();
    throw abortError();
  }
  const wanted = new Map(backend.archivePaths.map((archivePath) => [archivePath, archivePath.slice(backend.archivePrefix.length)]));
  let extractedBytes = 0;

  try {
    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        if (error) reject(error);
        else resolve();
      };
      const onAbort = () => {
        zipFile.close();
        finish(abortError());
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      zipFile.on('error', finish);
      zipFile.on('end', () => finish());
      zipFile.on('entry', async (entry) => {
        try {
          throwIfAborted(signal);
          const relativePath = wanted.get(entry.fileName);
          if (!relativePath) {
            zipFile.readEntry();
            return;
          }
          const outputPath = path.join(destination, relativePath);
          await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
          const input = await openEntryStream(zipFile, entry);
          let entryBytes = 0;
          const counter = new Transform({
            transform(chunk, encoding, callback) {
              entryBytes += chunk.length;
              extractedBytes += chunk.length;
              if (entryBytes > entry.uncompressedSize || extractedBytes > backend.limits.maxTotalUncompressedSize) {
                callback(new Error('Extracted data exceeds declared archive limits'));
                return;
              }
              reportProgress({ phase: 'extract', extractedBytes, totalBytes: backend.installedSize });
              callback(null, chunk);
            }
          });
          await pipeline(input, counter, fs.createWriteStream(outputPath, { flags: 'wx', mode: 0o700 }), { signal });
          if (entryBytes !== entry.uncompressedSize) throw new Error(`Extracted size mismatch for ${entry.fileName}`);
          zipFile.readEntry();
        } catch (error) {
          zipFile.close();
          finish(error);
        }
      });
      zipFile.readEntry();
    });
  } finally {
    zipFile.close();
  }
  if (extractedBytes !== backend.installedSize) {
    throw new Error(`Installed size mismatch: expected ${backend.installedSize}, received ${extractedBytes}`);
  }
}

function createBackendInstaller({
  installRoot,
  catalog = BACKEND_CATALOG,
  request = https.request,
  progress,
  validator,
  getFreeSpace,
  requestTimeoutMs = 30000,
  maxRedirects = 5
}) {
  if (typeof installRoot !== 'string' || !path.isAbsolute(installRoot)) {
    throw new TypeError('A trusted absolute install root is required');
  }
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs <= 0) throw new TypeError('requestTimeoutMs must be positive');
  if (!Number.isInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > 10) throw new TypeError('maxRedirects is invalid');
  const activeInstalls = new Set();

  function getBackend(id) {
    const backend = catalog[id];
    if (!backend) throw new Error(`Unknown backend catalog ID: ${id}`);
    return backend;
  }

  function emitProgress(handler, event) {
    (handler || progress)?.(Object.freeze({ ...event }));
  }

  async function download(backend, outputPath, signal, handler) {
    const hash = crypto.createHash('sha256');
    let receivedBytes = 0;

    async function follow(url, redirectsRemaining) {
      throwIfAborted(signal);
      const parsed = validateDownloadUrl(url, backend.allowedHttpsHosts);
      await new Promise((resolve, reject) => {
        let settled = false;
        let req;
        let onAbort = () => {};
        const finish = (error) => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener('abort', onAbort);
          if (error) reject(error);
          else resolve();
        };
        req = request(parsed, { method: 'GET', headers: { 'User-Agent': 'MeetSummarizer-backend-installer', Accept: 'application/octet-stream' } }, (response) => {
          const statusCode = response.statusCode || 0;
          if (REDIRECT_CODES.has(statusCode)) {
            response.resume();
            if (redirectsRemaining === 0 || !response.headers.location) {
              finish(new Error('Download redirect limit exceeded or missing Location'));
              return;
            }
            let nextUrl;
            try {
              nextUrl = validateDownloadUrl(new URL(response.headers.location, parsed), backend.allowedHttpsHosts);
            } catch (error) {
              finish(error);
              return;
            }
            follow(nextUrl, redirectsRemaining - 1).then(() => finish(), finish);
            return;
          }
          if (statusCode !== 200) {
            response.resume();
            finish(new Error(`Download failed with HTTP ${statusCode}`));
            return;
          }
          const contentLength = Number(response.headers['content-length']);
          if (Number.isFinite(contentLength) && contentLength !== backend.asset.size) {
            response.resume();
            finish(new Error(`Download Content-Length mismatch: ${contentLength}`));
            return;
          }
          const counter = new Transform({
            transform(chunk, encoding, callback) {
              receivedBytes += chunk.length;
              if (receivedBytes > backend.asset.size) {
                callback(new Error('Download exceeds expected byte count'));
                return;
              }
              hash.update(chunk);
              emitProgress(handler, { id: backend.id, phase: 'download', receivedBytes, totalBytes: backend.asset.size });
              callback(null, chunk);
            }
          });
          pipeline(response, counter, fs.createWriteStream(outputPath, { flags: 'wx', mode: 0o600 }), { signal })
            .then(() => finish(), finish);
        });
        onAbort = () => {
          req.destroy(abortError());
          finish(abortError());
        };
        req.on('error', finish);
        signal?.addEventListener('abort', onAbort, { once: true });
        if (signal?.aborted) {
          onAbort();
          return;
        }
        req.setTimeout?.(requestTimeoutMs, () => req.destroy(new Error('Download request timed out')));
        req.end();
      });
    }

    await follow(backend.asset.url, maxRedirects);
    if (receivedBytes !== backend.asset.size) {
      throw new Error(`Download size mismatch: expected ${backend.asset.size}, received ${receivedBytes}`);
    }
    const digest = hash.digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(digest, 'hex'), Buffer.from(backend.asset.sha256, 'hex'))) {
      throw new Error('Download SHA256 mismatch');
    }
  }

  async function checkFreeSpace(backend) {
    let availableBytes;
    if (getFreeSpace) {
      availableBytes = await getFreeSpace(installRoot);
    } else if (typeof fs.promises.statfs === 'function') {
      const stats = await fs.promises.statfs(installRoot);
      availableBytes = Number(stats.bavail) * Number(stats.bsize);
    }
    if (Number.isFinite(availableBytes) && availableBytes < backend.requiredFreeSpace) {
      throw new Error(`Insufficient disk space: ${backend.requiredFreeSpace} bytes required, ${availableBytes} available`);
    }
  }

  async function install(id, { signal, progress: installProgress, validator: installValidator } = {}) {
    const backend = getBackend(id);
    if (activeInstalls.has(id)) throw new Error(`Backend installation is already running: ${id}`);
    activeInstalls.add(id);
    let stagingRoot = null;

    try {
      throwIfAborted(signal);
      const existing = await status(id);
      if (existing.installed) {
        return { backendId: backend.id, version: backend.version, installPath: existing.installPath, manifest: existing.manifest };
      }
      await fs.promises.mkdir(installRoot, { recursive: true });
      await checkFreeSpace(backend);
      const stagingParent = path.join(installRoot, '.staging');
      await fs.promises.mkdir(stagingParent, { recursive: true });
      stagingRoot = await fs.promises.mkdtemp(path.join(stagingParent, `${backend.id}-`));
      const archivePath = path.join(stagingRoot, backend.asset.name);
      const payloadPath = path.join(stagingRoot, 'payload');
      const backendRoot = path.join(installRoot, backend.id);
      const finalPath = path.join(backendRoot, backend.version);
      await download(backend, archivePath, signal, installProgress);
      const entries = await readCentralDirectory(archivePath, signal);
      const plan = planArchiveEntries(entries, backend);
      const selectedSize = plan.selected.reduce((sum, entry) => sum + entry.uncompressedSize, 0);
      if (selectedSize !== backend.installedSize) throw new Error(`Catalog installed size mismatch: ${selectedSize}`);
      await fs.promises.mkdir(payloadPath);
      await extractSelectedEntries(archivePath, payloadPath, backend, signal, (event) => {
        emitProgress(installProgress, { id: backend.id, ...event });
      });
      throwIfAborted(signal);
      const validate = installValidator || validator;
      if (validate) await validate({ backend, installPath: payloadPath, signal });
      throwIfAborted(signal);
      for (const requiredFile of backend.requiredFiles) {
        const stat = await fs.promises.stat(path.join(payloadPath, requiredFile));
        if (!stat.isFile()) throw new Error(`Required runtime file is missing: ${requiredFile}`);
      }
      const manifest = {
        schemaVersion: 1,
        backendId: backend.id,
        version: backend.version,
        commit: backend.commit,
        assetId: backend.asset.id,
        assetSha256: backend.asset.sha256,
        installedSize: backend.installedSize,
        installedAt: new Date().toISOString(),
        files: backend.archivePaths.map((fileName) => fileName.slice(backend.archivePrefix.length))
      };
      await fs.promises.writeFile(path.join(payloadPath, 'install-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, {
        encoding: 'utf8', flag: 'wx', mode: 0o600
      });
      throwIfAborted(signal);
      await fs.promises.mkdir(backendRoot, { recursive: true });
      try {
        await fs.promises.rename(payloadPath, finalPath);
      } catch (error) {
        const destinationExists = await fs.promises.stat(finalPath).then(() => true, () => false);
        if (!destinationExists || !['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(error.code)) throw error;
        const existing = await status(id);
        if (existing.installed) {
          return { backendId: backend.id, version: backend.version, installPath: finalPath, manifest: existing.manifest };
        }
        await fs.promises.rm(finalPath, { recursive: true, force: true });
        await fs.promises.rename(payloadPath, finalPath);
      }
      emitProgress(installProgress, { id: backend.id, phase: 'complete', installPath: finalPath });
      return { backendId: backend.id, version: backend.version, installPath: finalPath, manifest };
    } finally {
      activeInstalls.delete(id);
      if (stagingRoot) await fs.promises.rm(stagingRoot, { recursive: true, force: true }).catch(() => {});
    }
  }

  async function cleanupStaging() {
    await fs.promises.rm(path.join(installRoot, '.staging'), { recursive: true, force: true });
  }

  async function status(id) {
    const backend = getBackend(id);
    const installPath = path.join(installRoot, backend.id, backend.version);
    try {
      const manifest = JSON.parse(await fs.promises.readFile(path.join(installPath, 'install-manifest.json'), 'utf8'));
      const expectedFiles = backend.archivePaths.map((fileName) => fileName.slice(backend.archivePrefix.length));
      const valid = manifest.schemaVersion === 1 && manifest.backendId === backend.id &&
        manifest.version === backend.version && manifest.assetSha256 === backend.asset.sha256 &&
        manifest.installedSize === backend.installedSize && Array.isArray(manifest.files) &&
        manifest.files.length === expectedFiles.length && manifest.files.every((fileName, index) => fileName === expectedFiles[index]);
      if (!valid) return { id, installed: false, installPath: null, manifest: null };
      await Promise.all(backend.requiredFiles.map(async (fileName) => {
        const file = await fs.promises.stat(path.join(installPath, fileName));
        if (!file.isFile()) throw new Error(`Invalid installed runtime file: ${fileName}`);
      }));
      return { id, installed: true, installPath, manifest };
    } catch {
      return { id, installed: false, installPath: null, manifest: null };
    }
  }

  async function list() {
    return Promise.all(Object.keys(catalog).map((id) => status(id)));
  }

  async function remove(id) {
    const backend = getBackend(id);
    const installPath = path.join(installRoot, backend.id, backend.version);
    await fs.promises.rm(installPath, { recursive: true, force: true });
    try { await fs.promises.rmdir(path.join(installRoot, backend.id)); } catch {}
    return { id, removed: true };
  }

  return Object.freeze({ cleanupStaging, install, list, remove, status });
}

module.exports = {
  createBackendInstaller,
  planArchiveEntries,
  validateArchivePath,
  validateDownloadUrl
};
