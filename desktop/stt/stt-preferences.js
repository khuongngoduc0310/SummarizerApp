'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PREFERENCE_VERSION = 1;
const BACKEND_PREFERENCES = Object.freeze(['auto', 'cuda', 'vulkan', 'cpu']);
const DEFAULT_PREFERENCES = Object.freeze({ version: PREFERENCE_VERSION, backend: 'auto' });

function validatePreferences(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.version !== PREFERENCE_VERSION) return null;
  if (!BACKEND_PREFERENCES.includes(value.backend)) return null;
  return { version: PREFERENCE_VERSION, backend: value.backend };
}

function createSttPreferences(filePath, { fsPromises = fs.promises } = {}) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
    throw new TypeError('A trusted absolute preferences file path is required');
  }

  async function load() {
    try {
      const parsed = JSON.parse(await fsPromises.readFile(filePath, 'utf8'));
      return validatePreferences(parsed) || { ...DEFAULT_PREFERENCES };
    } catch {
      return { ...DEFAULT_PREFERENCES };
    }
  }

  async function save(backend) {
    if (!BACKEND_PREFERENCES.includes(backend)) {
      throw new TypeError(`Invalid STT backend preference: ${backend}`);
    }

    const value = { version: PREFERENCE_VERSION, backend };
    const directory = path.dirname(filePath);
    const temporaryPath = path.join(
      directory,
      `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
    );
    await fsPromises.mkdir(directory, { recursive: true });
    try {
      await fsPromises.writeFile(temporaryPath, `${JSON.stringify(value)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      await fsPromises.rename(temporaryPath, filePath);
    } finally {
      await fsPromises.rm(temporaryPath, { force: true }).catch(() => {});
    }
    return value;
  }

  return Object.freeze({ load, save });
}

module.exports = {
  BACKEND_PREFERENCES,
  DEFAULT_PREFERENCES,
  PREFERENCE_VERSION,
  createSttPreferences,
  validatePreferences
};
