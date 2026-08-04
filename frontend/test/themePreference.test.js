import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  getThemePreference,
  isValidTheme,
  setThemePreference
} from '../src/utils/themePreference.js';

const createStorage = (initial = {}) => {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    value(key) {
      return values.get(key);
    }
  };
};

test('theme preference defaults to dark when no value is stored', () => {
  assert.equal(getThemePreference(createStorage()), DEFAULT_THEME);
});

test('invalid stored values fall back to dark without changing the raw entry', () => {
  const storage = createStorage({ [THEME_STORAGE_KEY]: 'system' });

  assert.equal(getThemePreference(storage), DEFAULT_THEME);
  assert.equal(storage.value(THEME_STORAGE_KEY), 'system');
});

test('valid stored values are returned unchanged', () => {
  const storage = createStorage({ [THEME_STORAGE_KEY]: 'light' });

  assert.equal(getThemePreference(storage), 'light');
  assert.equal(isValidTheme('dark'), true);
  assert.equal(isValidTheme('light'), true);
  assert.equal(isValidTheme('system'), false);
});

test('writing a theme uses a direct non-expiring storage value', () => {
  const storage = createStorage();

  assert.equal(setThemePreference('light', storage), 'light');
  assert.equal(storage.value(THEME_STORAGE_KEY), 'light');
  assert.equal(getThemePreference(storage), 'light');

  assert.equal(setThemePreference('invalid', storage), DEFAULT_THEME);
  assert.equal(storage.value(THEME_STORAGE_KEY), DEFAULT_THEME);
});
