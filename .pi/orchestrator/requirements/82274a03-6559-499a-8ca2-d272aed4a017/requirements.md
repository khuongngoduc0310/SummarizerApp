# Requirements: Add a light theme for the app while retaining the existing dark theme.

- Goal: Add a light theme for the app while retaining the existing dark theme.
- Summary: The app will default to dark mode and provide a persistent light-mode alternative. Users can switch themes through synchronized quick and Settings controls, with changes applied immediately. Light mode covers all rendered interface states using neutral white and light-slate surfaces, preserves blue-violet accents, keeps media areas dark, meets WCAG AA contrast requirements, and uses a reduced-motion-aware color transition.

## Scope
- Retain the existing dark theme and add light mode as an alternative.
- Apply light styling to join, meeting, settings, loading, and error states.
- Provide a quick theme toggle in the top-right header on both join and meeting screens.
- Rename the existing settings modal to Settings and add an Appearance section near the top.
- Persist the selected theme indefinitely in the renderer profile until changed or app data is cleared.

## Constraints
- Dark mode remains the default when no saved preference exists.
- Light mode uses neutral white and light-slate surfaces while preserving existing blue-violet accents.
- Video tiles and media overlays remain dark in light mode.
- Theme selection affects only the rendered interface; native Electron window chrome remains OS-managed.
- Theme controls must stay synchronized and satisfy WCAG AA contrast, visible-focus, and control-readability requirements.
- Theme transitions must respect reduced-motion preferences.

## Acceptance criteria
- On first launch without a saved preference, the rendered interface uses dark mode.
- Users can switch between light and dark themes using either the header toggle or the Appearance selector in Settings.
- Changing the theme updates the open app immediately, and both controls display the same selected theme.
- The selected theme remains active across app restarts until changed or renderer app data is cleared.
- Light styling is present across join, meeting, settings, loading, and error states, while video tiles and media overlays remain dark.
- The quick control is a sun/moon icon button with an accessible label and tooltip in the top-right header of join and meeting screens.
- Light-theme text and controls meet WCAG AA contrast, have visible focus indicators, and remain readable.
- Theme switching uses a brief color transition, which is suppressed or reduced when the user prefers reduced motion.
- Changing the rendered theme does not alter native Electron window chrome.

## Interview record

### Should the existing dark theme remain available?
- Answer: Keep dark and add light as an alternative

### How should the app choose a theme when it starts?
- Answer: Default to dark and save the user's choice

### Where should users change the theme?
- Answer: Quick toggle plus a selector in Settings

### Which interface states should receive light styling?
- Answer: All states, including join, meeting, settings, loading, and errors

### In light mode, how should video tiles and their media overlays appear?
- Answer: Keep media areas dark while making surrounding app chrome light

### What visual direction should the light palette use?
- Answer: Neutral white and light slate, preserving current blue-violet accents

### What accessibility target should the light theme meet?
- Answer: WCAG AA contrast with visible focus and readable controls

### Where should the quick theme toggle appear?
- Answer: Top-right header on both join and meeting screens

### How should the quick toggle be presented?
- Answer: Sun/moon icon button with an accessible label and tooltip

### How should theme selection fit into the existing settings modal?
- Answer: Rename it to Settings and add an Appearance section near the top

### How long should the saved theme preference persist?
- Answer: Indefinitely in the renderer profile until changed or app data is cleared

### When a user changes the theme, when should it take effect?
- Answer: Immediately across the open app, with toggle and Settings kept in sync

### Should theme selection affect the native Electron window frame as well as the rendered interface?
- Answer: Theme the rendered interface only; leave native chrome OS-managed

### Should switching themes include a visual transition?
- Answer: Brief color transition that respects reduced-motion preferences
