/**
 * Simple token estimation and transcript truncation utility.
 *
 * Uses the heuristic ~4 characters ≈ 1 token, which is good enough
 * for truncation decisions without needing a real tokenizer.
 */

const CHARS_PER_TOKEN = 4;
const DEFAULT_MAX_TOKENS = 100_000; // well under GPT-4o 128K, leaves room for system prompt + response

/**
 * Estimate token count from a string.
 * @param {string} text
 * @returns {number}
 */
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Truncate segments to fit within maxTokens, keeping the newest segments.
 * Returns the truncated transcript string plus metadata.
 *
 * @param {Array<{text: string, start: number, end: number, transcript: {owner: {displayName: string}}}>} segments
 * @param {number} maxTokens
 * @returns {{ transcript: string, droppedCount: number, droppedDurationSec: number }}
 */
function truncateSegments(segments, maxTokens = DEFAULT_MAX_TOKENS) {
  // Build full transcript to check size
  const formatLine = (s) => `[${s.transcript.owner.displayName}]: ${s.text}`;
  const fullTranscript = segments.map(formatLine).join('\n');
  const totalTokens = estimateTokens(fullTranscript);

  if (totalTokens <= maxTokens) {
    return { transcript: fullTranscript, droppedCount: 0, droppedDurationSec: 0 };
  }

  // Work backwards from newest to oldest, accumulating until we hit the limit
  const kept = [];
  let tokenBudget = maxTokens;

  // Reserve tokens for the truncation notice
  const truncationNotice = `\n\n[Note: The transcript was truncated to fit the context window. The earliest portion of the meeting is not included.]`;
  const noticeTokens = estimateTokens(truncationNotice);
  tokenBudget -= noticeTokens;

  for (let i = segments.length - 1; i >= 0; i--) {
    const line = formatLine(segments[i]);
    const lineTokens = estimateTokens(line) + 1; // +1 for newline
    if (tokenBudget - lineTokens < 0) break;
    kept.unshift(line);
    tokenBudget -= lineTokens;
  }

  const droppedCount = segments.length - kept.length;
  const droppedDurationSec = droppedCount > 0
    ? Math.round(segments[droppedCount - 1]?.end || 0)
    : 0;

  return {
    transcript: kept.join('\n') + truncationNotice,
    droppedCount,
    droppedDurationSec
  };
}

module.exports = { estimateTokens, truncateSegments, DEFAULT_MAX_TOKENS };
