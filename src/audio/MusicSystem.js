/**
 * Adaptive procedural music system for Deep Underworld.
 *
 * Generates layered music that responds in real-time to:
 *   - depth          → darker tones, lower pitch, heavier reverb
 *   - creature proximity → dissonance, tension stingers, scary harmonics
 *   - sustained danger → pulses, acceleration, pressure tones
 *
 * All audio is synthesized with the Web Audio API — no sample files needed.
 */
const SCALES = {
  dorian:     [0, 2, 3, 5, 7, 9, 10],
  phrygian:   [0, 1, 3, 5, 7, 8, 10],
  locrian:    [0, 1, 3, 5, 6, 8, 10],
  chromatic:  [0, 1, 2, 3, 5, 6, 7, 8, 11],
};

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function lerp(a, b, t) {
  return a + (b - a) * Math.min(1, Math.max(0, t));
}

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

function pickIndex(len) {
  return Math.floor(Math.pow(Math.random(), 1.5) * len);
}

export class MusicSystem {
  constructor(audioCtx, outputBuses) {
    this.ctx = audioCtx;
    this.outputBuses = outputBuses;

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0;
    this.musicGain.connect(this.outputBuses.music);
    this.threatMaster = this.ctx.createGain();
    this.threatMaster.gain.value = 0;
    this.threatMaster.connect(this.outputBuses.threat || this.outputBuses.music);

    this.reverbSend = this.ctx.createGain();
    this.reverbSend.gain.value = 0.3;
    this._buildReverb();
    this.noiseBuffer = this._createNoiseBuffer(2.6);

    this._buildPadLayer();
    this._buildUndertowLayer();
    this._buildMelodyLayer();
    this._buildPulseLayer();
    this._buildTensionLayer();
    this._buildStressLayer();

    this.depth = 0;
    this.creatureProx = 0;
    this.dangerStress = 0;
    this.encounterIntensity = 0;
    this.time = 0;
    this.melodyTimer = 0;
    this.pulseTimer = 0;
    this.tensionTimer = 0;
    this.stressTimer = 0;
    this.started = false;
    this.fadedIn = false;
  }

  _createNoiseBuffer(duration) {
    const length = Math.max(1, Math.floor(this.ctx.sampleRate * duration));
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  _buildReverb() {
    const delays = [0.037, 0.053, 0.083, 0.127];
    const fb = 0.45;
    this._reverbDelays = delays.map(t => {
      const d = this.ctx.createDelay(0.2);
      d.delayTime.value = t;
      const g = this.ctx.createGain();
      g.gain.value = fb;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2500;
      this.reverbSend.connect(d);
      d.connect(lp);
      lp.connect(g);
      g.connect(d);           // feedback
      g.connect(this.musicGain);
      return { d, g, lp };
    });
  }

  _buildPadLayer() {
    this.padGain = this.ctx.createGain();
    this.padGain.gain.value = 0.045;
    this.padFilter = this.ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 460;
    this.padFilter.Q.value = 1;
    this.padFilter.connect(this.padGain);
    this.padGain.connect(this.musicGain);
    this.padGain.connect(this.reverbSend);

    this.padOscillators = [];
    const rootMidi = 36;
    const chord = [0, 7, 12, 19];
    for (const offset of chord) {
      const freq = midiToFreq(rootMidi + offset);
      for (const detune of [-6, 6]) {
        const osc = this.ctx.createOscillator();
        osc.type = detune < 0 ? 'sine' : 'triangle';
        osc.frequency.value = freq;
        osc.detune.value = detune;
        const lfo = this.ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = 0.025 + Math.random() * 0.045;
        const lfoDepth = this.ctx.createGain();
        lfoDepth.gain.value = 0.18;
        lfo.connect(lfoDepth);

        const oscGain = this.ctx.createGain();
        oscGain.gain.value = 0.42;
        lfoDepth.connect(oscGain.gain);

        osc.connect(oscGain);
        oscGain.connect(this.padFilter);
        osc.start();
        lfo.start();
        this.padOscillators.push({ osc, lfo, oscGain, baseFreq: freq, baseMidi: rootMidi + offset });
      }
    }
  }

  _buildUndertowLayer() {
    this.undertowGain = this.ctx.createGain();
    this.undertowGain.gain.value = 0.018;
    this.undertowFilter = this.ctx.createBiquadFilter();
    this.undertowFilter.type = 'lowpass';
    this.undertowFilter.frequency.value = 320;
    this.undertowFilter.Q.value = 0.9;
    this.undertowFilter.connect(this.undertowGain);
    this.undertowGain.connect(this.musicGain);
    this.undertowGain.connect(this.reverbSend);

    this.undertowVoices = [];
    const intervals = [0, 5, 10];
    for (const offset of intervals) {
      const oscA = this.ctx.createOscillator();
      oscA.type = 'triangle';
      oscA.frequency.value = midiToFreq(24 + offset);

      const oscB = this.ctx.createOscillator();
      oscB.type = 'sawtooth';
      oscB.frequency.value = midiToFreq(24 + offset) * 0.5;
      oscB.detune.value = -4 + Math.random() * 8;

      const voiceGain = this.ctx.createGain();
      voiceGain.gain.value = 0.18;

      const lfo = this.ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.035 + Math.random() * 0.04;
      const lfoDepth = this.ctx.createGain();
      lfoDepth.gain.value = 0.22;
      lfo.connect(lfoDepth);
      lfoDepth.connect(voiceGain.gain);

      oscA.connect(voiceGain);
      oscB.connect(voiceGain);
      voiceGain.connect(this.undertowFilter);

      oscA.start();
      oscB.start();
      lfo.start();

      this.undertowVoices.push({ oscA, oscB, voiceGain, lfo, baseOffset: offset });
    }
  }

  _buildMelodyLayer() {
    this.melodyGain = this.ctx.createGain();
    this.melodyGain.gain.value = 0.006;
    this.melodyFilter = this.ctx.createBiquadFilter();
    this.melodyFilter.type = 'bandpass';
    this.melodyFilter.frequency.value = 420;
    this.melodyFilter.Q.value = 0.85;
    this.melodyFilter.connect(this.melodyGain);
    this.melodyGain.connect(this.musicGain);
    this.melodyGain.connect(this.reverbSend);
  }

  _playNoiseAccent({ duration, gain, frequency, Q, destination, delay = 0 }) {
    if (!this.ctx || !this.noiseBuffer) return;

    const now = this.ctx.currentTime + delay;
    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = frequency;
    filter.Q.value = Q;

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(gain, now + 0.04);
    env.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    source.connect(filter);
    filter.connect(env);
    env.connect(destination);
    source.start(now, Math.random() * this.noiseBuffer.duration);
    source.stop(now + duration);
  }

  _playMelodyNote(scale, rootMidi, duration, threat) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const idx = pickIndex(Math.min(scale.length, 5));
    const midi = rootMidi - 12 + scale[idx];
    const freq = midiToFreq(midi);

    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * (1.02 + Math.random() * 0.02), now);
    osc.frequency.linearRampToValueAtTime(freq, now + Math.min(1, duration * 0.45));

    const shadow = this.ctx.createOscillator();
    shadow.type = 'triangle';
    shadow.frequency.setValueAtTime(freq * 0.5, now);
    shadow.detune.value = -7 + Math.random() * 14;

    const vibrato = this.ctx.createOscillator();
    vibrato.type = 'sine';
    vibrato.frequency.value = 1.4 + Math.random() * 1.1;
    const vibratoD = this.ctx.createGain();
    vibratoD.gain.value = freq * 0.0016;
    vibrato.connect(vibratoD);
    vibratoD.connect(osc.frequency);
    vibrato.start(now);
    vibrato.stop(now + duration + 0.5);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = Math.min(760, Math.max(220, freq * 1.7));
    filter.Q.value = 1.4;

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(0.2 + (1 - threat) * 0.2, now + Math.min(0.9, duration * 0.4));
    env.gain.setValueAtTime(0.12 + (1 - threat) * 0.08, now + duration * 0.65);
    env.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(filter);
    shadow.connect(filter);
    filter.connect(env);
    env.connect(this.melodyFilter);
    osc.start(now);
    shadow.start(now);
    osc.stop(now + duration + 0.1);
    shadow.stop(now + duration + 0.1);

    this._playNoiseAccent({
      duration: Math.max(0.8, duration * 0.8),
      gain: 0.0024 + (1 - threat) * 0.0016,
      frequency: Math.min(820, Math.max(300, freq * 2.1)),
      Q: 0.9,
      destination: this.melodyFilter,
    });
  }

  _buildPulseLayer() {
    this.pulseGain = this.ctx.createGain();
    this.pulseGain.gain.value = 0;
    this.pulseGain.connect(this.threatMaster);
  }

  _playPulseBeat(intensity, encounterIntensity) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(48 + intensity * 24, now);
    osc.frequency.exponentialRampToValueAtTime(26, now + 0.18);

    const env = this.ctx.createGain();
    const vol = 0.05 + intensity * 0.06 + encounterIntensity * 0.03;
    env.gain.setValueAtTime(vol, now);
    env.gain.exponentialRampToValueAtTime(0.001, now + 0.24);

    osc.connect(env);
    env.connect(this.pulseGain);
    osc.start(now);
    osc.stop(now + 0.25);

    this._playNoiseAccent({
      duration: 0.1,
      gain: vol * 0.35,
      frequency: 110 + intensity * 60,
      Q: 1.8,
      destination: this.pulseGain,
    });
  }

  _buildTensionLayer() {
    this.tensionGain = this.ctx.createGain();
    this.tensionGain.gain.value = 0;
    this.tensionFilter = this.ctx.createBiquadFilter();
    this.tensionFilter.type = 'lowpass';
    this.tensionFilter.frequency.value = 1500;
    this.tensionFilter.connect(this.tensionGain);
    this.tensionGain.connect(this.threatMaster);
  }

  _playTensionStinger(intensity, encounterIntensity = 0) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const dur = 2.2 + Math.random() * 2.4;

    const base = 42 + Math.floor(Math.random() * 10);
    const intervals = [0, 1, 6, 7, 13];
    const count = 2 + Math.floor((intensity + encounterIntensity) * 3);

    for (let i = 0; i < count; i++) {
      const midi = base + intervals[i % intervals.length];
      const freq = midiToFreq(midi);
      const osc = this.ctx.createOscillator();
      osc.type = i % 2 === 0 ? 'sawtooth' : 'triangle';
      osc.frequency.value = freq;
      osc.frequency.linearRampToValueAtTime(freq * (0.95 + Math.random() * 0.08), now + dur);

      const env = this.ctx.createGain();
      const vol = 0.008 * intensity + encounterIntensity * 0.006;
      env.gain.setValueAtTime(0, now);
      env.gain.linearRampToValueAtTime(vol, now + 0.4);
      env.gain.setValueAtTime(vol, now + dur * 0.5);
      env.gain.exponentialRampToValueAtTime(0.001, now + dur);

      osc.connect(env);
      env.connect(this.tensionFilter);
      osc.start(now);
      osc.stop(now + dur + 0.1);
    }

    this._playNoiseAccent({
      duration: Math.min(1.2, dur * 0.45),
      gain: 0.006 + intensity * 0.006 + encounterIntensity * 0.004,
      frequency: 360 + intensity * 260,
      Q: 1.2,
      destination: this.tensionGain,
    });
  }

  _playCreatureWarning(intensity, encounterIntensity = 0) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const dur = 1.4 + Math.random() * 0.8;

    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    const startFreq = 400 + Math.random() * 300;
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(startFreq * 0.24, now + dur);

    const lfo = this.ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 5 + intensity * 7 + encounterIntensity * 3;
    const lfoG = this.ctx.createGain();
    lfoG.gain.value = startFreq * 0.07;
    lfo.connect(lfoG);
    lfoG.connect(osc.frequency);
    lfo.start(now);
    lfo.stop(now + dur + 0.1);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = startFreq * 0.8;
    filter.Q.value = 8;

    const env = this.ctx.createGain();
    const vol = 0.009 * intensity + encounterIntensity * 0.007;
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(vol, now + 0.1);
    env.gain.exponentialRampToValueAtTime(0.001, now + dur);

    osc.connect(filter);
    filter.connect(env);
    env.connect(this.tensionGain);
    osc.start(now);
    osc.stop(now + dur + 0.1);

    this._playNoiseAccent({
      duration: dur * 0.7,
      gain: vol * 0.65,
      frequency: startFreq * 0.65,
      Q: 2.4,
      destination: this.tensionGain,
    });
  }

  _buildStressLayer() {
    this.stressGain = this.ctx.createGain();
    this.stressGain.gain.value = 0;
    this.stressGain.connect(this.threatMaster);

    this.stressOsc = this.ctx.createOscillator();
    this.stressOsc.type = 'triangle';
    this.stressOsc.frequency.value = 760;
    this.stressOscGain = this.ctx.createGain();
    this.stressOscGain.gain.value = 0;

    this.stressSub = this.ctx.createOscillator();
    this.stressSub.type = 'sine';
    this.stressSub.frequency.value = 380;
    this.stressSubGain = this.ctx.createGain();
    this.stressSubGain.gain.value = 0;

    this.stressLfo = this.ctx.createOscillator();
    this.stressLfo.type = 'sine';
    this.stressLfo.frequency.value = 2;
    this.stressLfoGain = this.ctx.createGain();
    this.stressLfoGain.gain.value = 0;
    this.stressLfo.connect(this.stressLfoGain);
    this.stressLfoGain.connect(this.stressOscGain.gain);

    this.stressOsc.connect(this.stressOscGain);
    this.stressSub.connect(this.stressSubGain);
    this.stressOscGain.connect(this.stressGain);
    this.stressSubGain.connect(this.stressGain);

    this.stressOsc.start();
    this.stressSub.start();
    this.stressLfo.start();
  }

  _playStressTick(intensity) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 200 + intensity * 600;

    const env = this.ctx.createGain();
    const vol = 0.02 + intensity * 0.04;
    env.gain.setValueAtTime(vol, now);
    env.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 300;

    osc.connect(filter);
    filter.connect(env);
    env.connect(this.stressGain);
    osc.start(now);
    osc.stop(now + 0.1);

    this._playNoiseAccent({
      duration: 0.09,
      gain: vol * 0.4,
      frequency: 620 + intensity * 320,
      Q: 3.2,
      destination: this.stressGain,
    });
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.musicGain.gain.setValueAtTime(0, this.ctx.currentTime);
    this.musicGain.gain.linearRampToValueAtTime(1, this.ctx.currentTime + 4);
    this.threatMaster.gain.setValueAtTime(0, this.ctx.currentTime);
    this.threatMaster.gain.linearRampToValueAtTime(1, this.ctx.currentTime + 1.5);
    this.fadedIn = true;
  }

  stop() {
    if (!this.started) return;
    this.musicGain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 2);
    this.threatMaster.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 1.5);
    this.started = false;
    this.fadedIn = false;
  }

  update(dt, stateOrDepth, nearestCreatureDist) {
    if (!this.started || !this.ctx) return;

    const state = typeof stateOrDepth === 'object'
      ? stateOrDepth
      : { depth: stateOrDepth, nearestCreatureDist };

    this.time += dt;
    this.depth = state.depth ?? 0;
    this.creatureProx = clamp01(1 - (state.nearestCreatureDist ?? Number.POSITIVE_INFINITY) / 60);
    this.encounterIntensity = clamp01(state.encounterState?.intensity ?? 0);
    this.dangerStress = clamp01(Math.max(this.encounterIntensity, (this.creatureProx - 0.22) / 0.78));

    const now = this.ctx.currentTime;
    const depthNorm = clamp01(this.depth / 800);
    const encounterState = state.encounterState?.state ?? 'IDLE';
    const encounterLift = encounterState === 'REVEAL'
      ? 0.28
      : encounterState === 'FOG_CLOSING'
        ? 0.18
        : encounterState === 'DRIFT'
          ? 0.12
          : 0;

    const threat = Math.max(this.creatureProx * 0.9, this.dangerStress * 0.85, this.encounterIntensity * 0.95);
    let scale, rootMidi;

    if (threat < 0.18) {
      scale = SCALES.dorian;
      rootMidi = 43;
    } else if (threat < 0.45) {
      scale = SCALES.phrygian;
      rootMidi = 41;
    } else if (threat < 0.75) {
      scale = SCALES.locrian;
      rootMidi = 38;
    } else {
      scale = SCALES.chromatic;
      rootMidi = 36;
    }

    rootMidi -= Math.floor(this.depth / 240) * 2;
    rootMidi = Math.max(28, rootMidi);

    const padCutoff = lerp(420, 150, depthNorm) * lerp(1, 0.48, threat);
    this.padFilter.frequency.setTargetAtTime(padCutoff, now, 1);

    const chordOffsets = threat < 0.4
      ? [0, 7, 10, 17]
      : threat < 0.75
        ? [0, 5, 8, 12]
        : [0, 1, 6, 10];
    for (let i = 0; i < this.padOscillators.length; i++) {
      const po = this.padOscillators[i];
      const chordIdx = Math.floor(i / 2);
      const newMidi = rootMidi - 12 + (chordOffsets[chordIdx] || 0);
      const targetFreq = midiToFreq(newMidi);
      po.osc.frequency.setTargetAtTime(targetFreq + (i % 2 === 0 ? -0.5 : 0.5), now, 2);
    }

    const padVol = lerp(0.038, 0.076, Math.max(depthNorm * 0.7, threat * 0.5, encounterLift));
    this.padGain.gain.setTargetAtTime(padVol, now, 1);

    const undertowOffsets = threat < 0.45
      ? [0, 5, 10]
      : this.encounterIntensity > 0.55
        ? [0, 1, 6]
        : [0, 1, 8];
    for (let i = 0; i < this.undertowVoices.length; i++) {
      const voice = this.undertowVoices[i];
      const targetMidi = rootMidi - 24 + undertowOffsets[i];
      const targetFreq = midiToFreq(targetMidi);
      voice.oscA.frequency.setTargetAtTime(targetFreq, now, 1.8);
      voice.oscB.frequency.setTargetAtTime(targetFreq * 0.5, now, 1.9);
    }
    this.undertowFilter.frequency.setTargetAtTime(lerp(300, 170, depthNorm) + threat * 170 + this.encounterIntensity * 90, now, 1.1);
    this.undertowGain.gain.setTargetAtTime(lerp(0.012, 0.036, Math.max(depthNorm * 0.55, threat, this.encounterIntensity)), now, 0.9);

    this.melodyTimer += dt;
    const melInterval = lerp(12.5, 7.5, depthNorm) + threat * 3.2 + this.encounterIntensity * 5.2;
    if (this.melodyTimer > melInterval) {
      this.melodyTimer = 0;
      if (Math.random() < 0.72 - this.encounterIntensity * 0.45) {
        const dur = lerp(5, 2.4, threat + this.encounterIntensity * 0.3);
        this._playMelodyNote(scale, rootMidi, dur, threat);
        if (Math.random() < 0.16 - threat * 0.08) {
          setTimeout(() => this._playMelodyNote(scale, rootMidi, dur * 0.68, threat), (0.45 + Math.random() * 0.5) * 1000);
        }
      }
    }

    const melVol = lerp(0.0025, 0.007, depthNorm) * (1 - threat * 0.4) * (1 - this.encounterIntensity * 0.75);
    this.melodyGain.gain.setTargetAtTime(melVol, now, 0.5);
    this.melodyFilter.frequency.setTargetAtTime(lerp(340, 560, depthNorm) * lerp(1, 0.8, threat), now, 0.8);

    const pulseIntensity = clamp01(Math.max(this.dangerStress, this.encounterIntensity * 0.85));
    const pulseActive = pulseIntensity > 0.12;
    const pulseTempo = lerp(1.8, 0.26, pulseIntensity);
    this.pulseGain.gain.setTargetAtTime(pulseActive ? lerp(0.22, 1, pulseIntensity) : 0, now, 0.4);

    if (pulseActive) {
      this.pulseTimer += dt;
      if (this.pulseTimer > pulseTempo) {
        this.pulseTimer = 0;
        this._playPulseBeat(pulseIntensity, this.encounterIntensity);
      }
    }

    const tensionIntensity = Math.max(this.creatureProx, this.encounterIntensity * 0.8);
    const tensionActive = tensionIntensity > 0.18;
    this.tensionGain.gain.setTargetAtTime(tensionActive ? 1 : 0, now, 0.8);
    this.tensionFilter.frequency.setTargetAtTime(lerp(1200, 2200, tensionIntensity), now, 0.8);

    if (tensionActive) {
      this.tensionTimer += dt;
      const tensionInt = lerp(11, 2.8, tensionIntensity);
      if (this.tensionTimer > tensionInt) {
        this.tensionTimer = 0;
        this._playTensionStinger(tensionIntensity, this.encounterIntensity);
      }

      if (this.creatureProx > 0.58 && Math.random() < dt * (0.25 + tensionIntensity * 0.85 + this.encounterIntensity * 0.6)) {
        this._playCreatureWarning(this.creatureProx, this.encounterIntensity);
      }
    } else {
      this.tensionTimer = Math.max(0, this.tensionTimer - dt);
    }

    const stressIntensity = Math.max(this.dangerStress, this.encounterIntensity * 0.92);
    const stressActive = stressIntensity > 0.18;
    this.stressGain.gain.setTargetAtTime(stressActive ? 1 : 0, now, 0.5);

    const stressToneVol = stressActive ? stressIntensity * 0.012 + this.encounterIntensity * 0.008 : 0;
    this.stressOscGain.gain.setTargetAtTime(stressToneVol, now, 0.3);
    this.stressSubGain.gain.setTargetAtTime(stressToneVol * 0.45, now, 0.3);
    this.stressLfo.frequency.setTargetAtTime(lerp(1.8, 10, stressIntensity), now, 0.3);
    this.stressLfoGain.gain.setTargetAtTime(stressToneVol, now, 0.3);
    this.stressOsc.frequency.setTargetAtTime(lerp(560, 1040, stressIntensity), now, 1);
    this.stressSub.frequency.setTargetAtTime(lerp(280, 520, stressIntensity), now, 1);

    if (stressActive) {
      this.stressTimer += dt;
      const stressTickRate = lerp(1.8, 0.16, stressIntensity);
      if (this.stressTimer > stressTickRate) {
        this.stressTimer = 0;
        this._playStressTick(stressIntensity);
      }
    }

    const reverbWet = Math.min(0.48, lerp(0.2, 0.39, depthNorm) + this.encounterIntensity * 0.08);
    this.reverbSend.gain.setTargetAtTime(reverbWet, now, 1);
  }

  dispose() {
    for (const po of this.padOscillators) {
      po.osc.stop();
      po.lfo.stop();
    }
    for (const voice of this.undertowVoices) {
      voice.oscA.stop();
      voice.oscB.stop();
      voice.lfo.stop();
    }
    this.stressOsc.stop();
    this.stressSub.stop();
    this.stressLfo.stop();
  }
}
