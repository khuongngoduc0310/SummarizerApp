export const DEFAULT_THEME = 'dark';
export const THEME_STORAGE_KEY = 'meetsummarizer_theme';
export const THEME_VALUES = Object.freeze(['dark', 'light']);

export const isValidTheme = (value) => THEME_VALUES.includes(value);

export const normalizeTheme = (value) => (isValidTheme(value) ? value : DEFAULT_THEME);

const getStorage = (storage) => storage ?? globalThis.localStorage;

export const getThemePreference = (storage) => {
  try {
    return normalizeTheme(getStorage(storage)?.getItem(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME;
  }
};

export const setThemePreference = (theme, storage) => {
  const normalizedTheme = normalizeTheme(theme);

  try {
    getStorage(storage)?.setItem(THEME_STORAGE_KEY, normalizedTheme);
  } catch {
    // Renderer storage can be unavailable or disabled; the in-memory state still applies.
  }

  return normalizedTheme;
};

// Descriptive aliases keep the read/write behavior easy to discover at call sites.
export const readThemePreference = getThemePreference;
export const writeThemePreference = setThemePreference;
export const getStoredTheme = getThemePreference;
export const setStoredTheme = setThemePreference;
