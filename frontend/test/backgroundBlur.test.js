import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BACKGROUND_BLUR_OUTPUT_FRAME_RATE,
  BACKGROUND_BLUR_SEGMENTATION_FRAME_RATE,
  BACKGROUND_BLUR_SEGMENTATION_INTERVAL_MS,
  BackgroundBlurProcessor,
  getBlurOutputDimensions,
  getNextBlurFrameDelay
} from '../src/utils/backgroundBlur.js';
import { replacePeerVideoTrack } from '../src/utils/videoTrackSender.js';

test('background blur bounds landscape and portrait output dimensions', () => {
  assert.deepEqual(getBlurOutputDimensions(1920, 1080), { width: 640, height: 360 });
  assert.deepEqual(getBlurOutputDimensions(1280, 720), { width: 640, height: 360 });
  assert.deepEqual(getBlurOutputDimensions(1080, 1920), { width: 203, height: 360 });
});

test('background blur waits for the sixteen FPS segmentation budget', () => {
  assert.equal(BACKGROUND_BLUR_OUTPUT_FRAME_RATE, 30);
  assert.equal(BACKGROUND_BLUR_SEGMENTATION_FRAME_RATE, 16);
  assert.equal(getNextBlurFrameDelay(100, 100), BACKGROUND_BLUR_SEGMENTATION_INTERVAL_MS);
  assert.equal(getNextBlurFrameDelay(100, 100 + BACKGROUND_BLUR_SEGMENTATION_INTERVAL_MS), 0);
});

test('background blur schedules work from decoded video frames when available', (t) => {
  const originalWindow = globalThis.window;
  const timers = [];
  const videoCallbacks = new Map();
  let nextVideoFrameId = 1;
  let processedFrames = 0;
  let renderedFrames = 0;
  globalThis.window = {
    setTimeout: (callback, delay) => {
      timers.push({ callback, delay });
      return timers.length;
    },
    clearTimeout: () => {}
  };
  t.after(() => {
    globalThis.window = originalWindow;
  });

  const processor = new BackgroundBlurProcessor();
  processor.video = {
    requestVideoFrameCallback: (callback) => {
      const id = nextVideoFrameId++;
      videoCallbacks.set(id, callback);
      return id;
    }
  };
  processor.processFrame = () => { processedFrames += 1; };
  processor.renderFrame = () => { renderedFrames += 1; };

  processor.scheduleNextInference();
  assert.equal(timers[0].delay, BACKGROUND_BLUR_SEGMENTATION_INTERVAL_MS);
  timers[0].callback();
  assert.equal(processor.inferenceVideoFrameId, 1);
  videoCallbacks.get(1)();
  assert.equal(processedFrames, 1);

  processor.scheduleNextRender();
  assert.equal(processor.renderVideoFrameId, 2);
  videoCallbacks.get(2)();
  assert.equal(renderedFrames, 1);
});

test('background blur caps decoded-frame rendering at 30 FPS', () => {
  const videoCallbacks = new Map();
  let nextVideoFrameId = 1;
  let renderedFrames = 0;
  const processor = new BackgroundBlurProcessor();
  processor.video = {
    requestVideoFrameCallback: (callback) => {
      const id = nextVideoFrameId++;
      videoCallbacks.set(id, callback);
      return id;
    }
  };
  processor.renderFrame = () => {
    renderedFrames += 1;
    processor.scheduleNextRender();
  };

  processor.scheduleNextRender();
  videoCallbacks.get(1)(0);
  videoCallbacks.get(2)(16);
  videoCallbacks.get(3)(34);

  assert.equal(renderedFrames, 2);
});

test('background blur cancels pending video-frame callbacks on disposal', () => {
  const cancelledFrameIds = [];
  const processor = new BackgroundBlurProcessor();
  processor.video = {
    cancelVideoFrameCallback: (id) => cancelledFrameIds.push(id),
    pause: () => {}
  };
  processor.inferenceVideoFrameId = 11;
  processor.renderVideoFrameId = 12;

  processor.dispose();

  assert.deepEqual(cancelledFrameIds, [11, 12]);
  assert.equal(processor.inferenceVideoFrameId, null);
  assert.equal(processor.renderVideoFrameId, null);
});

test('adding video does not reuse a receive-only remote transceiver', async () => {
  const remoteVideoSender = { track: null, replaceTrack: async () => assert.fail('must not replace a remote sender') };
  const addedSender = { track: { kind: 'video' }, replaceTrack: async () => {} };
  const pc = {
    getSenders: () => [remoteVideoSender],
    addTrack: (track, stream) => {
      assert.equal(track.kind, 'video');
      assert.equal(stream.id, 'outgoing');
      return addedSender;
    }
  };

  const sender = await replacePeerVideoTrack(pc, null, { kind: 'video' }, { id: 'outgoing' });
  assert.equal(sender, addedSender);
});

test('an existing local video sender is replaced without adding another track', async () => {
  let replacement = null;
  const sender = { track: { kind: 'video' }, replaceTrack: async (track) => { replacement = track; } };
  const pc = {
    getSenders: () => [sender],
    addTrack: () => assert.fail('must not add a duplicate video sender')
  };
  const nextTrack = { kind: 'video' };

  assert.equal(await replacePeerVideoTrack(pc, sender, nextTrack, {}), sender);
  assert.equal(replacement, nextTrack);
});
