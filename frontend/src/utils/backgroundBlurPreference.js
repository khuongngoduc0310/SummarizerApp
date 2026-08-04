export const BACKGROUND_BLUR_STORAGE_KEY = 'meetsummarizer.backgroundBlur';

export const getBackgroundBlurPreference = (storage = globalThis.localStorage) => (
  storage?.getItem(BACKGROUND_BLUR_STORAGE_KEY) === 'true'
);

export const setBackgroundBlurPreference = (enabled, storage = globalThis.localStorage) => {
  const value = enabled === true;
  storage?.setItem(BACKGROUND_BLUR_STORAGE_KEY, String(value));
  return value;
};
