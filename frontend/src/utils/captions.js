const getCaptionKey = (caption) => {
  if (caption?.captionId) return `caption:${caption.captionId}`;
  if (caption?.utteranceId) return `utterance:${caption.meetingId || ''}:${caption.speakerId || ''}:${caption.utteranceId}`;
  return null;
};

const compareCaptions = (left, right) => {
  const leftTime = left.createdAt ? Date.parse(left.createdAt) : Number.NaN;
  const rightTime = right.createdAt ? Date.parse(right.createdAt) : Number.NaN;

  if (!Number.isNaN(leftTime) && !Number.isNaN(rightTime) && leftTime !== rightTime) {
    return leftTime - rightTime;
  }

  if (left.captionId && right.captionId && left.captionId !== right.captionId) {
    return left.captionId.localeCompare(right.captionId);
  }

  return 0;
};

export const mergeCaptions = (current, incoming) => {
  const merged = [...current];
  const indexes = new Map();

  merged.forEach((caption, index) => {
    const key = getCaptionKey(caption);
    if (key) indexes.set(key, index);
  });

  incoming.forEach((caption) => {
    const key = getCaptionKey(caption);
    const existingIndex = key ? indexes.get(key) : undefined;

    if (existingIndex !== undefined) {
      merged[existingIndex] = { ...merged[existingIndex], ...caption };
      return;
    }

    if (key) indexes.set(key, merged.length);
    merged.push(caption);
  });

  return merged.sort(compareCaptions);
};
