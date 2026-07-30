const fs = require('fs');
const path = require('path');

let _koffi = null;
try { _koffi = require('koffi'); } catch { _koffi = null; }

function pad(n) {
  return _koffi ? _koffi.array('uint8_t', n) : null;
}

let _WP = null;
let _WC = null;
let _libUtils = null;

function ensureStructs(koffi) {
  if (_WP) return;
  _WC = koffi.struct('WhisperCtxParams', {
    use_gpu: 'bool',
    flash_attn: 'bool',
    gpu_device: 'int',
    dtw_token_timestamps: 'bool',
    dtw_aheads_preset: 'int',
    dtw_n_top: 'int',
    dtw_aheads_n_heads: 'size_t',
    dtw_aheads_heads: 'void*',
    dtw_mem_size: 'size_t'
  });

  _WP = koffi.struct('WhisperFullParams', {
    strategy: 'int', n_threads: 'int', n_max_text_ctx: 'int', offset_ms: 'int', duration_ms: 'int',
    translate: 'bool', no_context: 'bool', no_timestamps: 'bool',
    single_segment: 'bool', print_special: 'bool', print_progress: 'bool',
    print_realtime: 'bool', print_timestamps: 'bool', token_timestamps: 'bool',
    _p1: pad(7),
    thold_pt: 'float', thold_ptsum: 'float', max_len: 'int',
    split_on_word: 'bool', _p2: pad(3), max_tokens: 'int',
    debug_mode: 'bool', _p3: pad(3), audio_ctx: 'int',
    tdrz_enable: 'bool', _p4: pad(7),
    suppress_regex: 'void*', initial_prompt: 'void*',
    carry_initial_prompt: 'bool', _p5: pad(7),
    prompt_tokens: 'void*', prompt_n_tokens: 'int', _p6: pad(4),
    language: 'void*',
    detect_language: 'bool', suppress_blank: 'bool', suppress_nst: 'bool', _p7: pad(5),
    temperature: 'float', max_initial_ts: 'float', length_penalty: 'float',
    temperature_inc: 'float', entropy_thold: 'float', logprob_thold: 'float',
    no_speech_thold: 'float',
    greedy_best_of: 'int', beam_search_beam_size: 'int', beam_search_patience: 'float',
    new_segment_callback: 'void*', new_segment_callback_user_data: 'void*',
    progress_callback: 'void*', progress_callback_user_data: 'void*',
    encoder_begin_callback: 'void*', encoder_begin_callback_user_data: 'void*',
    abort_callback: 'void*', abort_callback_user_data: 'void*',
    logits_filter_callback: 'void*', logits_filter_callback_user_data: 'void*',
    grammar_rules: 'void*', n_grammar_rules: 'size_t', i_start_rule: 'size_t',
    grammar_penalty: 'float', _p8: pad(4),
    vad: 'bool', _p9: pad(7),
    vad_model_path: 'void*',
    vad_threshold: 'float', vad_min_speech_duration_ms: 'int',
    vad_min_silence_duration_ms: 'int', vad_max_speech_duration_s: 'float',
    vad_speech_pad_ms: 'int', vad_samples_overlap: 'float'
  });
}

class WhisperFFI {
  constructor({ dllDir } = {}) {
    this._lib = null;
    this._ctx = null;
    this._modelPath = null;
    this._loaded = false;
    this._dllDir = dllDir || null;
    this._WHISPER_SAMPLING_GREEDY = 0;
  }

  static isAvailable() {
    return !!_koffi;
  }

  static defaultDllDir(baseDir) {
    const candidates = ['vulkan', 'cuda', 'cpu'];
    for (const backend of candidates) {
      const dllPath = path.join(baseDir, 'bin', backend, 'whisper.dll');
      if (fs.existsSync(dllPath)) {
        const vulkanDll = path.join(baseDir, 'bin', backend, 'ggml-vulkan.dll');
        if (backend === 'vulkan' && !fs.existsSync(vulkanDll)) continue;
        return path.join(baseDir, 'bin', backend);
      }
    }
    return null;
  }

  static availableBackends(baseDir) {
    const result = [];
    const candidates = {
      vulkan: { label: 'Vulkan GPU', acceleration: 'gpu', priority: 10, extra: ['ggml-vulkan.dll'] },
      cuda: { label: 'CUDA GPU', acceleration: 'gpu', priority: 15, extra: [] },
      cpu: { label: 'CPU', acceleration: 'cpu', priority: 5, extra: [] }
    };
    for (const [id, info] of Object.entries(candidates)) {
      const dir = path.join(baseDir, 'bin', id);
      const dllPath = path.join(dir, 'whisper.dll');
      if (!fs.existsSync(dllPath)) continue;
      const missingExtra = info.extra.filter((f) => !fs.existsSync(path.join(dir, f)));
      if (missingExtra.length) continue;
      result.push({ id, ...info, dllDir: dir });
    }
    return result.sort((a, b) => b.priority - a.priority);
  }

  initialize(dllDir) {
    if (!_koffi) throw new Error('koffi is not available — install with: npm install koffi');
    if (this._lib) return;

    const resolvedDir = dllDir || this._dllDir;
    if (!resolvedDir) throw new Error('DLL directory is required');

    const dllPath = path.resolve(resolvedDir, 'whisper.dll');
    if (!fs.existsSync(dllPath)) throw new Error(`whisper.dll not found at ${dllPath}`);

    const envPath = process.env.PATH || '';
    if (!envPath.split(path.delimiter).includes(resolvedDir)) {
      process.env.PATH = resolvedDir + path.delimiter + envPath;
    }

    this._dllDir = resolvedDir;
    this._lib = _koffi.load(dllPath);
    ensureStructs(_koffi);
  }

  isInitialized() {
    return !!this._lib;
  }

  isLoaded() {
    return this._loaded && !!this._ctx;
  }

  loadModel(modelPath, { use_gpu = true, flash_attn = true, gpu_device = 0 } = {}) {
    if (!this._lib) throw new Error('FFI not initialized — call initialize() first');
    if (this._ctx) this.free();

    const initParams = this._lib.func('WhisperCtxParams whisper_context_default_params()')();
    initParams.use_gpu = !!use_gpu;
    initParams.flash_attn = !!flash_attn;
    initParams.gpu_device = typeof gpu_device === 'number' ? gpu_device : 0;

    this._modelPath = path.resolve(modelPath);
    if (!fs.existsSync(this._modelPath)) throw new Error(`Model not found: ${this._modelPath}`);

    const initWithParams = this._lib.func('void* whisper_init_from_file_with_params(const char* path, WhisperCtxParams params)');
    this._ctx = initWithParams(this._modelPath, initParams);

    if (!this._ctx) throw new Error('whisper_init_from_file_with_params returned null — model may be invalid');
    this._loaded = true;

    this._fullFn = this._lib.func('int whisper_full(void* ctx, WhisperFullParams params, const float* samples, int n_samples)');
    this._nSegFn = this._lib.func('int whisper_full_n_segments(void* ctx)');
    this._getSegTextFn = this._lib.func('const char* whisper_full_get_segment_text(void* ctx, int i_segment)');
    this._getSegT0Fn = this._lib.func('int64_t whisper_full_get_segment_t0(void* ctx, int i_segment)');
    this._getSegT1Fn = this._lib.func('int64_t whisper_full_get_segment_t1(void* ctx, int i_segment)');
    this._getDefaultParamsFn = this._lib.func('WhisperFullParams whisper_full_default_params(int strategy)');
  }

  transcribe(pcmF32, { n_threads = 4, language = null, no_timestamps = false } = {}) {
    if (!this._loaded || !this._ctx) throw new Error('Model not loaded');
    if (!(pcmF32 instanceof Float32Array) || !pcmF32.length) throw new Error('pcmF32 must be a non-empty Float32Array');

    const params = this._getDefaultParamsFn(this._WHISPER_SAMPLING_GREEDY);
    params.n_threads = n_threads;
    params.no_timestamps = !!no_timestamps;
    if (language) params.language = _koffi.as(language, 'const char*');

    const ret = this._fullFn(this._ctx, params, pcmF32, pcmF32.length);
    if (ret !== 0) throw new Error(`whisper_full failed with code ${ret}`);

    const n = this._nSegFn(this._ctx);
    const segments = [];
    let text = '';
    for (let i = 0; i < n; i++) {
      const t0 = Number(this._getSegT0Fn(this._ctx, i));
      const t1 = Number(this._getSegT1Fn(this._ctx, i));
      const segText = this._getSegTextFn(this._ctx, i) || '';
      segments.push({ t0, t1, text: segText });
      if (text) text += ' ';
      text += segText;
    }

    return { text: text.trim(), segments, n };
  }

  free() {
    if (this._ctx) {
      try {
        const freeFn = this._lib.func('void whisper_free(void* ctx)');
        freeFn(this._ctx);
      } catch { }
      this._ctx = null;
    }
    this._loaded = false;
    this._fullFn = null;
    this._nSegFn = null;
    this._getSegTextFn = null;
    this._getSegT0Fn = null;
    this._getSegT1Fn = null;
    this._getDefaultParamsFn = null;
    this._lib = null;
    this._modelPath = null;
  }
}

module.exports = { WhisperFFI };
