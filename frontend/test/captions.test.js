import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeCaptions } from '../src/utils/captions.js';

test('merges history with live captions in chronological order', () => {
  const live = [{
    captionId: 'caption-c',
    text: 'Live',
    createdAt: '2026-07-28T12:00:03.000Z'
  }];
  const history = [
    { captionId: 'caption-a', text: 'First', createdAt: '2026-07-28T12:00:01.000Z' },
    { captionId: 'caption-b', text: 'Second', createdAt: '2026-07-28T12:00:02.000Z' }
  ];

  assert.deepEqual(
    mergeCaptions(live, history).map((caption) => caption.captionId),
    ['caption-a', 'caption-b', 'caption-c']
  );
});

test('deduplicates history and live events by persisted caption id', () => {
  const current = [{ captionId: 'caption-a', text: 'Live value', speakerName: 'A' }];
  const history = [{ captionId: 'caption-a', text: 'Persisted value', createdAt: '2026-07-28T12:00:01.000Z' }];
  const result = mergeCaptions(current, history);

  assert.equal(result.length, 1);
  assert.equal(result[0].text, 'Persisted value');
  assert.equal(result[0].speakerName, 'A');
});

test('deduplicates legacy live events by utterance id', () => {
  const current = [{ meetingId: 'm', speakerId: 's', utteranceId: 'u', text: 'First' }];
  const incoming = [{ meetingId: 'm', speakerId: 's', utteranceId: 'u', text: 'Updated' }];

  assert.deepEqual(mergeCaptions(current, incoming), [{
    meetingId: 'm',
    speakerId: 's',
    utteranceId: 'u',
    text: 'Updated'
  }]);
});

test('does not collapse unidentified captions with identical content', () => {
  const caption = { speakerId: 's', text: 'Repeated' };
  assert.equal(mergeCaptions([caption], [caption]).length, 2);
});
