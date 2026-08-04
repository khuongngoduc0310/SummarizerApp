import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BACKGROUND_BLUR_STORAGE_KEY,
  getBackgroundBlurPreference,
  setBackgroundBlurPreference
} from '../src/utils/backgroundBlurPreference.js';

const createStorage = (initial = {}) => {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    }
  };
};

test('background blur is off by default', () => {
  assert.equal(getBackgroundBlurPreference(createStorage()), false);
});

test('background blur only accepts the stored true value', () => {
  assert.equal(getBackgroundBlurPreference(createStorage({ [BACKGROUND_BLUR_STORAGE_KEY]: 'true' })), true);
  assert.equal(getBackgroundBlurPreference(createStorage({ [BACKGROUND_BLUR_STORAGE_KEY]: 'yes' })), false);
});

test('background blur preference is stored without an expiry wrapper', () => {
  const storage = createStorage();

  assert.equal(setBackgroundBlurPreference(true, storage), true);
  assert.equal(storage.getItem(BACKGROUND_BLUR_STORAGE_KEY), 'true');
  assert.equal(setBackgroundBlurPreference(false, storage), false);
  assert.equal(storage.getItem(BACKGROUND_BLUR_STORAGE_KEY), 'false');
});
