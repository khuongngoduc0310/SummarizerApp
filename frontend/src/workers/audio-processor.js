class AudioProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input.length > 0) {
      const inputData = input[0];
      // Note: We send the Float32Array as is. 
      // In a more complex app, we might want to handle multiple channels or sample rates.
      this.port.postMessage(inputData);
    }
    return true;
  }
}

registerProcessor('audio-processor', AudioProcessor);
