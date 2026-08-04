export const BACKGROUND_BLUR_STATUS = {
  OFF: 'off',
  LOADING: 'loading',
  ACTIVE: 'active',
  UNAVAILABLE: 'unavailable'
};

export const BACKGROUND_BLUR_SEGMENTATION_FRAME_RATE = 8;
export const BACKGROUND_BLUR_SEGMENTATION_INTERVAL_MS = 1000 / BACKGROUND_BLUR_SEGMENTATION_FRAME_RATE;
export const BACKGROUND_BLUR_OUTPUT_FRAME_RATE = 30;
export const BACKGROUND_BLUR_OUTPUT_INTERVAL_MS = 1000 / BACKGROUND_BLUR_OUTPUT_FRAME_RATE;
export const BACKGROUND_BLUR_MAX_WIDTH = 640;
export const BACKGROUND_BLUR_MAX_HEIGHT = 360;
const INFERENCE_WIDTH = 256;
const BLUR_RADIUS = 18;
let selfieSegmentationPromise;

const loadSelfieSegmentation = async () => {
  selfieSegmentationPromise ??= import('@mediapipe/selfie_segmentation')
    .then(({ SelfieSegmentation }) => SelfieSegmentation);
  return selfieSegmentationPromise;
};

const getAssetUrl = (file) => new URL(
  `${import.meta.env.BASE_URL}background-blur/${file}`,
  window.location.href
).toString();

export const isBackgroundBlurSupported = () => (
  typeof window !== 'undefined'
  && typeof MediaStream !== 'undefined'
  && typeof HTMLCanvasElement !== 'undefined'
  && typeof HTMLCanvasElement.prototype.captureStream === 'function'
);

export const getBlurOutputDimensions = (width, height) => {
  if (!width || !height) return { width: BACKGROUND_BLUR_MAX_WIDTH, height: BACKGROUND_BLUR_MAX_HEIGHT };
  const scale = Math.min(1, BACKGROUND_BLUR_MAX_WIDTH / width, BACKGROUND_BLUR_MAX_HEIGHT / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
};

export const getNextBlurFrameDelay = (startedAt, now) => {
  const delay = BACKGROUND_BLUR_SEGMENTATION_INTERVAL_MS - (now - startedAt);
  return delay > 0.5 ? delay : 0;
};

export class BackgroundBlurProcessor {
  constructor({ onStatus, onFailure } = {}) {
    this.onStatus = onStatus;
    this.onFailure = onFailure;
    this.video = null;
    this.canvas = null;
    this.context = null;
    this.foregroundCanvas = null;
    this.foregroundContext = null;
    this.maskCanvas = null;
    this.maskContext = null;
    this.inferenceCanvas = null;
    this.inferenceContext = null;
    this.segmenter = null;
    this.outputStream = null;
    this.inferenceFrameId = null;
    this.inferenceVideoFrameId = null;
    this.inferenceTimerId = null;
    this.renderFrameId = null;
    this.renderVideoFrameId = null;
    this.renderTimerId = null;
    this.lastRenderAt = null;
    this.processing = false;
    this.hasMask = false;
    this.failed = false;
    this.disposed = false;
  }

  async start(sourceStream) {
    if (!isBackgroundBlurSupported()) {
      throw new Error('Background blur is not supported on this device.');
    }

    const sourceTrack = sourceStream?.getVideoTracks?.()[0];
    if (!sourceTrack || sourceTrack.readyState !== 'live') {
      throw new Error('Turn on your camera to use background blur.');
    }

    this.onStatus?.(BACKGROUND_BLUR_STATUS.LOADING);
    this.video = document.createElement('video');
    this.video.autoplay = true;
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.srcObject = new MediaStream([sourceTrack]);
    await this.video.play();

    this.canvas = document.createElement('canvas');
    this.context = this.canvas.getContext('2d', { alpha: false });
    this.foregroundCanvas = document.createElement('canvas');
    this.foregroundContext = this.foregroundCanvas.getContext('2d');
    this.maskCanvas = document.createElement('canvas');
    this.maskContext = this.maskCanvas.getContext('2d');
    this.inferenceCanvas = document.createElement('canvas');
    this.inferenceContext = this.inferenceCanvas.getContext('2d');
    if (!this.context || !this.foregroundContext || !this.maskContext || !this.inferenceContext) {
      throw new Error('Background blur could not create a video canvas.');
    }

    const SelfieSegmentation = await loadSelfieSegmentation();
    this.segmenter = new SelfieSegmentation({
      locateFile: (file) => getAssetUrl(file)
    });
    // Preview mirroring is CSS-only; keep the mask in the camera track's coordinates.
    this.segmenter.setOptions({ modelSelection: 1, selfieMode: false });
    this.segmenter.onResults((results) => this.draw(results));
    await this.segmenter.initialize();

    this.resizeCanvases(this.video.videoWidth, this.video.videoHeight);
    this.outputStream = this.canvas.captureStream(BACKGROUND_BLUR_OUTPUT_FRAME_RATE);
    this.disposed = false;
    this.scheduleNextInference();
    this.scheduleNextRender();
    this.onStatus?.(BACKGROUND_BLUR_STATUS.ACTIVE);
    return this.outputStream;
  }

  draw(results) {
    if (this.disposed || !this.maskContext || !this.canvas) return;

    const width = this.video.videoWidth;
    const height = this.video.videoHeight;
    if (!width || !height) return;

    this.resizeCanvases(width, height);
    const outputWidth = this.canvas.width;
    const outputHeight = this.canvas.height;

    this.maskContext.clearRect(0, 0, outputWidth, outputHeight);
    this.maskContext.drawImage(results.segmentationMask, 0, 0, outputWidth, outputHeight);
    this.hasMask = true;
  }

  resizeCanvases(width, height) {
    const output = getBlurOutputDimensions(width, height);
    if (this.canvas.width !== output.width || this.canvas.height !== output.height) {
      this.canvas.width = output.width;
      this.canvas.height = output.height;
      this.foregroundCanvas.width = output.width;
      this.foregroundCanvas.height = output.height;
      this.maskCanvas.width = output.width;
      this.maskCanvas.height = output.height;
      this.hasMask = false;
    }

    const inferenceHeight = Math.max(1, Math.round(INFERENCE_WIDTH * (height || 1) / (width || 1)));
    if (this.inferenceCanvas.width !== INFERENCE_WIDTH || this.inferenceCanvas.height !== inferenceHeight) {
      this.inferenceCanvas.width = INFERENCE_WIDTH;
      this.inferenceCanvas.height = inferenceHeight;
    }
  }

  scheduleNextInference(delay = BACKGROUND_BLUR_SEGMENTATION_INTERVAL_MS) {
    if (this.disposed || this.failed) return;
    this.inferenceTimerId = window.setTimeout(() => {
      this.inferenceTimerId = null;
      if (typeof this.video?.requestVideoFrameCallback === 'function') {
        this.inferenceVideoFrameId = this.video.requestVideoFrameCallback(() => {
          this.inferenceVideoFrameId = null;
          this.processFrame();
        });
      } else {
        this.inferenceFrameId = requestAnimationFrame(() => this.processFrame());
      }
    }, delay);
  }

  scheduleNextRender(delay = BACKGROUND_BLUR_OUTPUT_INTERVAL_MS) {
    if (this.disposed) return;
    if (typeof this.video?.requestVideoFrameCallback === 'function') {
      this.renderVideoFrameId = this.video.requestVideoFrameCallback((now) => {
        this.renderVideoFrameId = null;
        if (this.lastRenderAt === null || now - this.lastRenderAt >= BACKGROUND_BLUR_OUTPUT_INTERVAL_MS - 0.5) {
          this.lastRenderAt = now;
          this.renderFrame();
        } else {
          this.scheduleNextRender();
        }
      });
    } else {
      this.renderTimerId = window.setTimeout(() => {
        this.renderTimerId = null;
        this.renderFrameId = requestAnimationFrame(() => this.renderFrame());
      }, delay);
    }
  }

  async processFrame() {
    if (this.disposed || this.failed) return;

    if (this.video?.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && !this.processing) {
      this.processing = true;
      const startedAt = performance.now();
      try {
        this.resizeCanvases(this.video.videoWidth, this.video.videoHeight);
        this.inferenceContext.drawImage(this.video, 0, 0, this.inferenceCanvas.width, this.inferenceCanvas.height);
        await this.segmenter.send({ image: this.inferenceCanvas });
      } catch (error) {
        this.onStatus?.(BACKGROUND_BLUR_STATUS.UNAVAILABLE, error);
        this.failed = true;
        this.onFailure?.(error);
        return;
      } finally {
        this.processing = false;
      }
      this.scheduleNextInference(getNextBlurFrameDelay(startedAt, performance.now()));
      return;
    }

    this.scheduleNextInference();
  }

  renderFrame() {
    if (this.disposed) return;

    if (this.video?.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && this.context && this.foregroundContext) {
      this.resizeCanvases(this.video.videoWidth, this.video.videoHeight);
      const outputWidth = this.canvas.width;
      const outputHeight = this.canvas.height;

      if (this.hasMask) {
        this.foregroundContext.globalCompositeOperation = 'source-over';
        this.foregroundContext.drawImage(this.video, 0, 0, outputWidth, outputHeight);
        this.foregroundContext.globalCompositeOperation = 'destination-in';
        this.foregroundContext.drawImage(this.maskCanvas, 0, 0, outputWidth, outputHeight);
        this.foregroundContext.globalCompositeOperation = 'source-over';

        this.context.save();
        this.context.filter = `blur(${BLUR_RADIUS}px)`;
        this.context.drawImage(this.video, 0, 0, outputWidth, outputHeight);
        this.context.restore();
        this.context.drawImage(this.foregroundCanvas, 0, 0, outputWidth, outputHeight);
      } else {
        this.context.drawImage(this.video, 0, 0, outputWidth, outputHeight);
      }
    }

    this.scheduleNextRender();
  }

  dispose() {
    this.disposed = true;
    if (this.inferenceFrameId !== null) cancelAnimationFrame(this.inferenceFrameId);
    if (this.inferenceVideoFrameId !== null) this.video?.cancelVideoFrameCallback?.(this.inferenceVideoFrameId);
    if (this.inferenceTimerId !== null) clearTimeout(this.inferenceTimerId);
    if (this.renderFrameId !== null) cancelAnimationFrame(this.renderFrameId);
    if (this.renderVideoFrameId !== null) this.video?.cancelVideoFrameCallback?.(this.renderVideoFrameId);
    if (this.renderTimerId !== null) clearTimeout(this.renderTimerId);
    this.inferenceFrameId = null;
    this.inferenceVideoFrameId = null;
    this.inferenceTimerId = null;
    this.renderFrameId = null;
    this.renderVideoFrameId = null;
    this.renderTimerId = null;
    this.lastRenderAt = null;
    this.outputStream?.getTracks().forEach((track) => track.stop());
    this.outputStream = null;
    this.video?.pause();
    if (this.video) this.video.srcObject = null;
    this.video = null;
    this.canvas = null;
    this.context = null;
    this.foregroundCanvas = null;
    this.foregroundContext = null;
    this.maskCanvas = null;
    this.maskContext = null;
    this.inferenceCanvas = null;
    this.inferenceContext = null;
    this.segmenter?.close().catch(() => {});
    this.segmenter = null;
  }
}
