/**
 * Adaptive procedural music system for Deep Underworld.
 *
 * Generates layered music that responds in real-time to:
 *   - depth          → darker tones, lower pitch, heavier reverb
 *   - creature proximity → dissonance, tension stingers, scary harmonics
 *   - oxygen level   → tempo increase, rhythmic urgency, stress tones
 *
 * All audio is synthesized with the Web Audio API — no sample files needed.
 */

// ---------------------------------------------------------------------------
// Musical scales (semitone offsets from root)
// ---------------------------------------------------------------------------
const SCALES = {
  // calm / exploration
  dorian:     [0, 2, 3, 5, 7, 9, 10],
  // uneasy
  phrygian:   [0, 1, 3, 5, 7, 8, 10],
  // ominous
  locrian:    [0, 1, 3, 5, 6, 8, 10],
  // terrifying – whole-tone + chromatic cluster
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

// Pick a weighted-random index biased toward low indices
function pickIndex(len) {
  return Math.floor(Math.pow(Math.random(), 1.5) * len);
}

// ---------------------------------------------------------------------------
// MusicSystem
// ---------------------------------------------------------------------------
export class MusicSystem {
  constructor(audioCtx, masterGain) {
    this.ctx = audioCtx;
    this.master = masterGain;

    // ---- mix bus ----
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0;            // fade in on start
    this.musicGain.connect(this.master);

    // ---- shared reverb (convolution-free, delay-based) ----
    this.reverbSend = this.ctx.createGain();
    this.reverbSend.gain.value = 0.35;
    this._buildReverb();

    // ---- layers ----
    this._buildPadLayer();
    this._buildMelodyLayer();
    this._buildPulseLayer();
    this._buildTensionLayer();
    this._buildStressLayer();

    // ---- state ----
    this.depth = 0;
    this.creatureProx = 0;       // 0 = far, 1 = touching
    this.oxygenStress = 0;       // 0 = full, 1 = empty
    this.time = 0;
    this.melodyTimer = 0;
    this.melodyInterval = 4;
    this.pulseTimer = 0;
    this.tensionTimer = 0;
    this.tensionInterval = 12;
    this.stressTimer = 0;
    this.started = false;
    this.fadedIn = false;
  }

  // =========================================================================
  //  REVERB (simple feedback-delay network)
  // =========================================================================
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

  // =========================================================================
  //  PAD LAYER – slow evolving drone chords
  // =========================================================================
  _buildPadLayer() {
    this.padGain = this.ctx.createGain();
    this.padGain.gain.value = 0.07;
    this.padFilter = this.ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 800;
    this.padFilter.Q.value = 1;
    this.padFilter.connect(this.padGain);
    this.padGain.connect(this.musicGain);
    this.padGain.connect(this.reverbSend);

    // 4 detuned oscillator pairs forming a chord
    this.padOscillators = [];
    const rootMidi = 36; // C2
    const chord = [0, 7, 12, 19]; // root, 5th, octave, 5th+octave
    for (const offset of chord) {
      const freq = midiToFreq(rootMidi + offset);
      // Two oscillators slightly detuned for richness
      for (const detune of [-6, 6]) {
        const osc = this.ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;
        osc.detune.value = detune;
        // Slow LFO on volume for swelling
        const lfo = this.ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = 0.05 + Math.random() * 0.08;
        const lfoDepth = this.ctx.createGain();
        lfoDepth.gain.value = 0.3;
        lfo.connect(lfoDepth);

        const oscGain = this.ctx.createGain();
        oscGain.gain.value = 0.5;
        lfoDepth.connect(oscGain.gain);

        osc.connect(oscGain);
        oscGain.connect(this.padFilter);
        osc.start();
        lfo.start();
        this.padOscillators.push({ osc, lfo, oscGain, baseFreq: freq, baseMidi: rootMidi + offset });
      }
    }
  }

  // =========================================================================
  //  MELODY LAYER – sparse single notes from current scale
  // =========================================================================
  _buildMelodyLayer() {
    this.melodyGain = this.ctx.createGain();
    this.melodyGain.gain.value = 0.04;
    this.melodyFilter = this.ctx.createBiquadFilter();
    this.melodyFilter.type = 'lowpass';
    this.melodyFilter.frequency.value = 1200;
    this.melodyFilter.connect(this.melodyGain);
    this.melodyGain.connect(this.musicGain);
    this.melodyGain.connect(this.reverbSend);
  }

  _playMelodyNote(scale, rootMidi, duration) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const idx = pickIndex(scale.length);
    const octave = Math.random() < 0.3 ? 12 : 0;
    const midi = rootMidi + scale[idx] + octave;
    const freq = midiToFreq(midi);

    const osc = this.ctx.createOscillator();
    osc.type = Math.random() < 0.5 ? 'sine' : 'triangle';
    osc.frequency.value = freq;

    // Slow vibrato
    const vibrato = this.ctx.createOscillator();
    vibrato.type = 'sine';
    vibrato.frequency.value = 4 + Math.random() * 2;
    const vibratoD = this.ctx.createGain();
    vibratoD.gain.value = freq * 0.008;
    vibrato.connect(vibratoD);
    vibratoD.connect(osc.frequency);
    vibrato.start(now);
    vibrato.stop(now + duration + 0.5);

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(1, now + 0.3);
    env.gain.setValueAtTime(1, now + duration * 0.6);
    env.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(env);
    env.connect(this.melodyFilter);
    osc.start(now);
    osc.stop(now + duration + 0.1);
  }

  // =========================================================================
  //  PULSE LAYER – rhythmic heartbeat / clock that follows stress
  // =========================================================================
  _buildPulseLayer() {
    this.pulseGain = this.ctx.createGain();
    this.pulseGain.gain.value = 0;
    this.pulseGain.connect(this.musicGain);
  }

  _playPulseBeat(tempo, intensity) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    // Low thud
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(55 + intensity * 20, now);
    osc.frequency.exponentialRampToValueAtTime(30, now + 0.15);

    const env = this.ctx.createGain();
    const vol = 0.08 * intensity;
    env.gain.setValueAtTime(vol, now);
    env.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

    osc.connect(env);
    env.connect(this.pulseGain);
    osc.start(now);
    osc.stop(now + 0.25);

    // Noise burst for texture at high stress
    if (intensity > 0.5) {
      const bufSize = this.ctx.sampleRate * 0.05;
      const buf = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * 0.3;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const ng = this.ctx.createGain();
      ng.gain.setValueAtTime(vol * 0.5, now);
      ng.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      const nf = this.ctx.createBiquadFilter();
      nf.type = 'bandpass';
      nf.frequency.value = 100;
      nf.Q.value = 2;
      src.connect(nf);
      nf.connect(ng);
      ng.connect(this.pulseGain);
      src.start(now);
    }
  }

  // =========================================================================
  //  TENSION LAYER – dissonant stingers when creatures are near
  // =========================================================================
  _buildTensionLayer() {
    this.tensionGain = this.ctx.createGain();
    this.tensionGain.gain.value = 0;
    this.tensionFilter = this.ctx.createBiquadFilter();
    this.tensionFilter.type = 'lowpass';
    this.tensionFilter.frequency.value = 3000;
    this.tensionFilter.connect(this.tensionGain);
    this.tensionGain.connect(this.musicGain);
    this.tensionGain.connect(this.reverbSend);
  }

  _playTensionStinger(intensity) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const dur = 2 + Math.random() * 3;

    // Cluster of close-interval notes
    const base = 48 + Math.floor(Math.random() * 12);
    const intervals = [0, 1, 6, 7, 13]; // tritones and minor 2nds
    const count = 2 + Math.floor(intensity * 3);

    for (let i = 0; i < count; i++) {
      const midi = base + intervals[i % intervals.length];
      const freq = midiToFreq(midi);
      const osc = this.ctx.createOscillator();
      osc.type = i % 2 === 0 ? 'sawtooth' : 'triangle';
      osc.frequency.value = freq;
      // Random slow glide
      osc.frequency.linearRampToValueAtTime(freq * (0.97 + Math.random() * 0.06), now + dur);

      const env = this.ctx.createGain();
      const vol = 0.015 * intensity;
      env.gain.setValueAtTime(0, now);
      env.gain.linearRampToValueAtTime(vol, now + 0.5);
      env.gain.setValueAtTime(vol, now + dur * 0.5);
      env.gain.exponentialRampToValueAtTime(0.001, now + dur);

      osc.connect(env);
      env.connect(this.tensionFilter);
      osc.start(now);
      osc.stop(now + dur + 0.1);
    }
  }

  // high dissonant screech when something is very close
  _playCreatureWarning(intensity) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const dur = 1.5 + Math.random();

    // Descending howl
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    const startFreq = 400 + Math.random() * 300;
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(startFreq * 0.3, now + dur);

    const lfo = this.ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 6 + intensity * 8;
    const lfoG = this.ctx.createGain();
    lfoG.gain.value = startFreq * 0.1;
    lfo.connect(lfoG);
    lfoG.connect(osc.frequency);
    lfo.start(now);
    lfo.stop(now + dur + 0.1);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = startFreq * 0.8;
    filter.Q.value = 8;

    const env = this.ctx.createGain();
    const vol = 0.025 * intensity;
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(vol, now + 0.1);
    env.gain.exponentialRampToValueAtTime(0.001, now + dur);

    osc.connect(filter);
    filter.connect(env);
    env.connect(this.tensionGain);
    osc.start(now);
    osc.stop(now + dur + 0.1);
  }

  // =========================================================================
  //  STRESS LAYER – accelerating rhythmic alarm when oxygen is low
  // =========================================================================
  _buildStressLayer() {
    this.stressGain = this.ctx.createGain();
    this.stressGain.gain.value = 0;
    this.stressGain.connect(this.musicGain);

    // Continuous high-pitched oscillator that fades in under stress
    this.stressOsc = this.ctx.createOscillator();
    this.stressOsc.type = 'sine';
    this.stressOsc.frequency.value = 880;
    this.stressOscGain = this.ctx.createGain();
    this.stressOscGain.gain.value = 0;
    // Tremolo LFO
    this.stressLfo = this.ctx.createOscillator();
    this.stressLfo.type = 'sine';
    this.stressLfo.frequency.value = 2;
    this.stressLfoGain = this.ctx.createGain();
    this.stressLfoGain.gain.value = 0;
    this.stressLfo.connect(this.stressLfoGain);
    this.stressLfoGain.connect(this.stressOscGain.gain);

    this.stressOsc.connect(this.stressOscGain);
    this.stressOscGain.connect(this.stressGain);

    this.stressOsc.start();
    this.stressLfo.start();
  }

  _playStressTick(intensity) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    // Metallic ping
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
  }

  // =========================================================================
  //  START / STOP
  // =========================================================================
  start() {
    if (this.started) return;
    this.started = true;
    // Gentle fade in
    this.musicGain.gain.setValueAtTime(0, this.ctx.currentTime);
    this.musicGain.gain.linearRampToValueAtTime(1, this.ctx.currentTime + 4);
    this.fadedIn = true;
  }

  stop() {
    if (!this.started) return;
    this.musicGain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 2);
    this.started = false;
    this.fadedIn = false;
  }

  // =========================================================================
  //  UPDATE – called every frame from Game
  // =========================================================================
  update(dt, depth, nearestCreatureDist) {
    if (!this.started || !this.ctx) return;

    this.time += dt;
    this.depth = depth;
    this.creatureProx = clamp01(1 - nearestCreatureDist / 60);
    this.oxygenStress = 0;

    const now = this.ctx.currentTime;

    // ---- Determine current mood / scale ----
    const threat = Math.max(this.creatureProx, this.oxygenStress * 0.6);
    let scale, rootMidi;

    if (threat < 0.2) {
      scale = SCALES.dorian;
      rootMidi = 48; // C3
    } else if (threat < 0.5) {
      scale = SCALES.phrygian;
      rootMidi = 47; // B2
    } else if (threat < 0.75) {
      scale = SCALES.locrian;
      rootMidi = 46; // Bb2
    } else {
      scale = SCALES.chromatic;
      rootMidi = 45; // A2
    }

    // Lower root further with depth
    rootMidi -= Math.floor(depth / 200) * 2;
    rootMidi = Math.max(30, rootMidi);

    // ---- PAD LAYER ----
    const padCutoff = lerp(800, 250, clamp01(depth / 400)) * lerp(1, 0.5, threat);
    this.padFilter.frequency.setTargetAtTime(padCutoff, now, 1);

    // Shift pad chord to match mood
    const chordOffsets = threat < 0.5
      ? [0, 7, 12, 19]      // power chord (5ths)
      : [0, 3, 6, 12];      // diminished
    for (let i = 0; i < this.padOscillators.length; i++) {
      const po = this.padOscillators[i];
      const chordIdx = Math.floor(i / 2);
      const newMidi = rootMidi - 12 + (chordOffsets[chordIdx] || 0);
      const targetFreq = midiToFreq(newMidi);
      po.osc.frequency.setTargetAtTime(targetFreq + (i % 2 === 0 ? -0.5 : 0.5), now, 2);
    }

    const padVol = lerp(0.06, 0.10, clamp01(depth / 300));
    this.padGain.gain.setTargetAtTime(padVol, now, 1);

    // ---- MELODY LAYER ----
    this.melodyTimer += dt;
    const melInterval = lerp(5, 1.5, threat);
    if (this.melodyTimer > melInterval) {
      this.melodyTimer = 0;
      const dur = lerp(3, 1, threat);
      this._playMelodyNote(scale, rootMidi, dur);
      // Sometimes play a second note for richer texture
      if (Math.random() < 0.3 + threat * 0.3) {
        setTimeout(() => this._playMelodyNote(scale, rootMidi, dur * 0.7), (0.2 + Math.random() * 0.5) * 1000);
      }
    }

    const melVol = lerp(0.03, 0.06, clamp01(depth / 200));
    this.melodyGain.gain.setTargetAtTime(melVol, now, 0.5);

    // ---- PULSE LAYER (oxygen stress) ----
    const pulseActive = this.oxygenStress > 0.1;
    const pulseTempo = lerp(1.2, 0.25, this.oxygenStress); // seconds between beats
    this.pulseGain.gain.setTargetAtTime(pulseActive ? 1 : 0, now, 0.5);

    if (pulseActive) {
      this.pulseTimer += dt;
      if (this.pulseTimer > pulseTempo) {
        this.pulseTimer = 0;
        this._playPulseBeat(pulseTempo, this.oxygenStress);
      }
    }

    // ---- TENSION LAYER (creature proximity) ----
    const tensionActive = this.creatureProx > 0.15;
    this.tensionGain.gain.setTargetAtTime(tensionActive ? 1 : 0, now, 0.8);

    if (tensionActive) {
      this.tensionTimer += dt;
      const tensionInt = lerp(10, 2, this.creatureProx);
      if (this.tensionTimer > tensionInt) {
        this.tensionTimer = 0;
        this._playTensionStinger(this.creatureProx);
      }

      // Creature very close – play warning sounds
      if (this.creatureProx > 0.6 && Math.random() < dt * this.creatureProx * 1.5) {
        this._playCreatureWarning(this.creatureProx);
      }
    } else {
      this.tensionTimer = Math.max(0, this.tensionTimer - dt);
    }

    // ---- STRESS LAYER (oxygen) ----
    const stressActive = this.oxygenStress > 0.2;
    this.stressGain.gain.setTargetAtTime(stressActive ? 1 : 0, now, 0.5);

    // High tone tremolo
    const stressToneVol = stressActive ? this.oxygenStress * 0.015 : 0;
    this.stressOscGain.gain.setTargetAtTime(stressToneVol, now, 0.3);
    this.stressLfo.frequency.setTargetAtTime(lerp(2, 12, this.oxygenStress), now, 0.3);
    this.stressLfoGain.gain.setTargetAtTime(stressToneVol, now, 0.3);
    this.stressOsc.frequency.setTargetAtTime(lerp(660, 1200, this.oxygenStress), now, 1);

    if (stressActive) {
      this.stressTimer += dt;
      const stressTickRate = lerp(1.5, 0.18, this.oxygenStress);
      if (this.stressTimer > stressTickRate) {
        this.stressTimer = 0;
        this._playStressTick(this.oxygenStress);
      }
    }

    // ---- REVERB wetness with depth ----
    const reverbWet = lerp(0.25, 0.55, clamp01(depth / 500));
    this.reverbSend.gain.setTargetAtTime(reverbWet, now, 1);
  }

  // =========================================================================
  //  DISPOSE
  // =========================================================================
  dispose() {
    for (const po of this.padOscillators) {
      po.osc.stop();
      po.lfo.stop();
    }
    this.stressOsc.stop();
    this.stressLfo.stop();
  }
}
