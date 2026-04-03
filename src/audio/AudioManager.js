import { MusicSystem } from './MusicSystem.js';

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function lerp(a, b, t) {
  return a + (b - a) * clamp01(t);
}

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.started = false;
    this.masterGain = null;
    this.masterCompressor = null;
    this.ambienceBus = null;
    this.musicBus = null;
    this.threatBus = null;
    this.uiBus = null;
    this.music = null;
    this.noiseBuffers = null;
    this.textureLayers = null;
    this.busDefaults = {
      ambience: 0.95,
      music: 0.82,
      threat: 0.95,
      ui: 1,
    };

    // Oscillator nodes
    this.drones = [];
    this.creakTimer = 0;
    this.creakInterval = 8 + Math.random() * 12;
    this.sonarOsc = null;
  }

  /**
   * Phase 1 (synchronous): Create AudioContext, master chain, and buses.
   * Must run inside a user-gesture context. Heavy work (noise buffers,
   * drones, texture bed, MusicSystem) is deferred to budgeted async phases
   * so the main thread is not blocked.
   */
  start() {
    if (this.started) return;
    // @ts-ignore — webkitAudioContext is a legacy vendor-prefixed API
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AudioContextCtor();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.46;
    this.masterCompressor = this.ctx.createDynamicsCompressor();
    this.masterCompressor.threshold.value = -26;
    this.masterCompressor.knee.value = 18;
    this.masterCompressor.ratio.value = 2.4;
    this.masterCompressor.attack.value = 0.02;
    this.masterCompressor.release.value = 0.45;
    this.masterGain.connect(this.masterCompressor);
    this.masterCompressor.connect(this.ctx.destination);
    this.ambienceBus = this._createBus(this.busDefaults.ambience);
    this.musicBus = this._createBus(this.busDefaults.music);
    this.threatBus = this._createBus(this.busDefaults.threat);
    this.uiBus = this._createBus(this.busDefaults.ui);
    this.started = true;

    // Kick off budgeted async build — audio layers will fade in gradually
    this._asyncBuildPromise = this._buildAudioGraphAsync();
  }

  /**
   * Phase 2+ (async, budgeted): Generate noise buffers, drones, texture bed,
   * and MusicSystem layers in small incremental steps, yielding to the
   * browser between phases so startup is not blocked.
   */
  async _buildAudioGraphAsync() {
    // Phase 2: Noise buffers (one per frame yield)
    const colors = ['white', 'pink', 'brown'];
    this.noiseBuffers = {};
    for (const color of colors) {
      this.noiseBuffers[color] = this._createNoiseBuffer(2.5, color);
      await new Promise(r => requestAnimationFrame(r));
    }

    // Phase 3: Drones (batch in pairs, yield between)
    const droneSpecs = [
      [34, 'sine', 0.042],
      [49, 'triangle', 0.026],
      [73, 'sine', 0.011],
      [22, 'sine', 0.03],
    ];
    for (let i = 0; i < droneSpecs.length; i++) {
      this._createDrone(...droneSpecs[i]);
      if (i % 2 === 1) await new Promise(r => requestAnimationFrame(r));
    }

    // Phase 4: Texture bed
    await new Promise(r => requestAnimationFrame(r));
    this._initTextureBed();

    // Phase 5: MusicSystem (constructor builds all layers)
    await new Promise(r => requestAnimationFrame(r));
    this.music = new MusicSystem(this.ctx, {
      music: this.musicBus,
      threat: this.threatBus,
    });
    this.music.start();
  }

  _createBus(defaultGain) {
    const bus = this.ctx.createGain();
    bus.gain.value = defaultGain;
    bus.connect(this.masterGain);
    return bus;
  }

  _createNoiseBuffer(duration, color = 'white') {
    const length = Math.max(1, Math.floor(this.ctx.sampleRate * duration));
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let brown = 0;
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let b3 = 0;
    let b4 = 0;
    let b5 = 0;
    let b6 = 0;

    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      let sample = white;

      if (color === 'brown') {
        brown = (brown + 0.045 * white) / 1.045;
        sample = brown * 3.5;
      } else if (color === 'pink') {
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        sample = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
        sample *= 0.11;
        b6 = white * 0.115926;
      }

      data[i] = Math.max(-1, Math.min(1, sample));
    }

    return buffer;
  }

  _createLoopingNoiseLayer({
    buffer,
    type,
    frequency,
    Q = 1,
    gain = 0.01,
    output = this.ambienceBus,
    playbackRate = 1,
    driftAmount = 0,
    driftRate = 0,
  }) {
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.playbackRate.value = playbackRate;

    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = Q;

    const layerGain = this.ctx.createGain();
    layerGain.gain.value = gain;

    let drift = null;
    let driftGain = null;
    if (driftAmount > 0 && driftRate > 0) {
      drift = this.ctx.createOscillator();
      drift.type = 'sine';
      drift.frequency.value = driftRate;
      driftGain = this.ctx.createGain();
      driftGain.gain.value = driftAmount;
      drift.connect(driftGain);
      driftGain.connect(filter.frequency);
      drift.start();
    }

    source.connect(filter);
    filter.connect(layerGain);
    layerGain.connect(output);
    source.start(0, Math.random() * buffer.duration);

    return {
      source,
      filter,
      gain: layerGain,
      drift,
      driftGain,
      baseFrequency: frequency,
      baseGain: gain,
      basePlaybackRate: playbackRate,
    };
  }

  _initTextureBed() {
    this.textureLayers = {
      pressure: this._createLoopingNoiseLayer({
        buffer: this.noiseBuffers.brown,
        type: 'lowpass',
        frequency: 140,
        gain: 0.012,
        playbackRate: 0.72,
        driftAmount: 16,
        driftRate: 0.018,
      }),
      undertow: this._createLoopingNoiseLayer({
        buffer: this.noiseBuffers.brown,
        type: 'bandpass',
        frequency: 68,
        Q: 0.8,
        gain: 0.02,
        playbackRate: 0.84,
        driftAmount: 10,
        driftRate: 0.027,
      }),
      hull: this._createLoopingNoiseLayer({
        buffer: this.noiseBuffers.pink,
        type: 'bandpass',
        frequency: 280,
        Q: 7,
        gain: 0.0025,
        playbackRate: 0.93,
        driftAmount: 52,
        driftRate: 0.031,
      }),
      current: this._createLoopingNoiseLayer({
        buffer: this.noiseBuffers.pink,
        type: 'highpass',
        frequency: 1400,
        gain: 0.0015,
        playbackRate: 1.04,
        driftAmount: 180,
        driftRate: 0.041,
      }),
      threatWash: this._createLoopingNoiseLayer({
        buffer: this.noiseBuffers.white,
        type: 'bandpass',
        frequency: 980,
        Q: 1.6,
        gain: 0.0001,
        output: this.threatBus,
        playbackRate: 0.9,
        driftAmount: 260,
        driftRate: 0.055,
      }),
    };
  }

  _createDrone(freq, type, vol) {
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const gain = this.ctx.createGain();
    gain.gain.value = vol;

    // Slow LFO modulation
    const lfo = this.ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.1 + Math.random() * 0.2;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = freq * 0.05;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    lfo.start();

    osc.connect(gain);
    gain.connect(this.ambienceBus);
    osc.start();

    this.drones.push({ osc, gain, lfo, baseFreq: freq, baseVol: vol });
  }

  _updateTextureBed(state) {
    if (!this.textureLayers) return;

    const depth = state.depth ?? 0;
    const nearestCreatureDist = state.nearestCreatureDist ?? Number.POSITIVE_INFINITY;
    const encounterState = state.encounterState?.state ?? 'IDLE';
    const depthNorm = clamp01(depth / 850);
    const creatureProx = clamp01(1 - nearestCreatureDist / 60);
    const encounterIntensity = clamp01(state.encounterState?.intensity ?? 0);
    const threat = clamp01(Math.max(creatureProx * 0.95, encounterIntensity, depthNorm * 0.22));
    const revealLift = encounterState === 'REVEAL' ? 0.18 : encounterState === 'FOG_CLOSING' ? 0.12 : 0;
    const now = this.ctx.currentTime;

    const pressure = this.textureLayers.pressure;
    pressure.filter.frequency.setTargetAtTime(lerp(180, 74, depthNorm), now, 1.8);
    pressure.gain.gain.setTargetAtTime(0.012 + depthNorm * 0.022 + encounterIntensity * 0.01, now, 1.2);
    pressure.source.playbackRate.setTargetAtTime(lerp(0.78, 0.62, depthNorm), now, 2.6);

    const undertow = this.textureLayers.undertow;
    undertow.filter.frequency.setTargetAtTime(lerp(88, 46, depthNorm) + encounterIntensity * 8, now, 1.6);
    undertow.gain.gain.setTargetAtTime(0.018 + depthNorm * 0.012 + threat * 0.01, now, 1.2);
    undertow.source.playbackRate.setTargetAtTime(lerp(0.88, 0.72, depthNorm), now, 2.2);

    const hull = this.textureLayers.hull;
    hull.filter.frequency.setTargetAtTime(lerp(360, 160, depthNorm) + threat * 60, now, 1.3);
    hull.gain.gain.setTargetAtTime(0.002 + depthNorm * 0.003 + threat * 0.005 + revealLift * 0.004, now, 1.0);
    hull.source.playbackRate.setTargetAtTime(lerp(0.96, 0.74, depthNorm), now, 1.8);

    const current = this.textureLayers.current;
    current.filter.frequency.setTargetAtTime(lerp(1800, 920, depthNorm) + threat * 180, now, 1.1);
    current.gain.gain.setTargetAtTime(0.001 + threat * 0.0035 + encounterIntensity * 0.004, now, 0.9);
    current.source.playbackRate.setTargetAtTime(lerp(1.06, 0.9, depthNorm), now, 1.4);

    const threatWash = this.textureLayers.threatWash;
    threatWash.filter.frequency.setTargetAtTime(lerp(820, 1520, threat) + encounterIntensity * 260, now, 0.8);
    threatWash.gain.gain.setTargetAtTime(threat * 0.006 + encounterIntensity * 0.014 + revealLift * 0.01, now, 0.65);
    threatWash.source.playbackRate.setTargetAtTime(0.84 + threat * 0.12 + encounterIntensity * 0.08, now, 0.9);
  }

  _duckBuses(multipliers, hold = 0.5, attack = 0.02, release = 0.6) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const buses = {
      ambience: this.ambienceBus,
      music: this.musicBus,
      threat: this.threatBus,
      ui: this.uiBus,
    };

    for (const [name, bus] of Object.entries(buses)) {
      if (!bus) continue;
      const multiplier = multipliers[name] ?? 1;
      const defaultGain = this.busDefaults[name];
      const gainParam = bus.gain;
      gainParam.cancelScheduledValues(now);
      gainParam.setValueAtTime(gainParam.value, now);
      gainParam.linearRampToValueAtTime(defaultGain * multiplier, now + attack);
      gainParam.setValueAtTime(defaultGain * multiplier, now + attack + hold);
      gainParam.linearRampToValueAtTime(defaultGain, now + attack + hold + release);
    }
  }

  _playNoiseBurst({
    duration = 1.5,
    gain = 0.01,
    filterType = 'bandpass',
    frequency = 400,
    Q = 1,
    attack = 0.02,
    release = duration,
    buffer = 'white',
    destination = this.ambienceBus,
    playbackRate = 1,
    delay = 0,
  }) {
    if (!this.ctx || !this.noiseBuffers) return;

    const now = this.ctx.currentTime + delay;
    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffers[buffer] || this.noiseBuffers.white;
    source.loop = true;
    source.playbackRate.value = playbackRate;

    const filter = this.ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = frequency;
    filter.Q.value = Q;

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(gain, now + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, now + Math.max(attack + 0.04, release));

    source.connect(filter);
    filter.connect(env);
    env.connect(destination);
    source.start(now, Math.random() * source.buffer.duration);
    source.stop(now + duration);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      env.disconnect();
    };
  }

  _playMetalGroan({
    startFreq = 180,
    endFreq = 60,
    duration = 2.6,
    gain = 0.02,
    Q = 4.5,
    destination = this.threatBus,
    waveform = 'sawtooth',
    delay = 0,
  }) {
    if (!this.ctx) return;

    const now = this.ctx.currentTime + delay;
    const carrier = this.ctx.createOscillator();
    carrier.type = waveform;
    carrier.frequency.setValueAtTime(startFreq, now);
    carrier.frequency.exponentialRampToValueAtTime(Math.max(18, endFreq), now + duration);

    const undertone = this.ctx.createOscillator();
    undertone.type = waveform === 'sine' ? 'triangle' : 'sine';
    undertone.frequency.setValueAtTime(startFreq * 0.52, now);
    undertone.frequency.exponentialRampToValueAtTime(Math.max(12, endFreq * 0.48), now + duration);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = startFreq * 1.8;
    filter.Q.value = Q;

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(gain, now + Math.min(0.18, duration * 0.18));
    env.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    carrier.connect(filter);
    undertone.connect(filter);
    filter.connect(env);
    env.connect(destination);

    carrier.start(now);
    undertone.start(now);
    carrier.stop(now + duration + 0.05);
    undertone.stop(now + duration + 0.05);
  }

  _playSubDrop({
    startFreq = 72,
    endFreq = 22,
    duration = 2.4,
    gain = 0.04,
    destination = this.threatBus,
    delay = 0,
  }) {
    if (!this.ctx) return;

    const now = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(12, endFreq), now + duration);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 140;

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(gain, now + 0.08);
    env.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(filter);
    filter.connect(env);
    env.connect(destination);
    osc.start(now);
    osc.stop(now + duration + 0.05);
  }

  _playEchoPulse({
    frequency = 260,
    duration = 0.18,
    gain = 0.016,
    destination = this.uiBus,
    delayTime = 0.7,
    echoGain = 0.2,
    delay = 0,
  }) {
    if (!this.ctx) return;

    const now = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(frequency, now);
    osc.frequency.exponentialRampToValueAtTime(frequency * 0.62, now + duration);

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(gain, now);
    env.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    const echo = this.ctx.createDelay(2.0);
    echo.delayTime.value = delayTime;
    const echoLevel = this.ctx.createGain();
    echoLevel.gain.value = echoGain;

    osc.connect(env);
    env.connect(destination);
    env.connect(echo);
    echo.connect(echoLevel);
    echoLevel.connect(destination);
    osc.start(now);
    osc.stop(now + duration + 0.05);
    osc.onended = () => {
      osc.disconnect();
      env.disconnect();
      setTimeout(() => {
        echo.disconnect();
        echoLevel.disconnect();
      }, (delayTime + 0.2) * 1000);
    };
  }

  _playCreak() {
    if (!this.ctx) return;
    this._playNoiseBurst({
      duration: 1,
      gain: 0.008,
      filterType: 'bandpass',
      frequency: 240 + Math.random() * 260,
      Q: 8,
      buffer: 'pink',
      playbackRate: 0.74 + Math.random() * 0.18,
    });
    this._playMetalGroan({
      startFreq: 210 + Math.random() * 90,
      endFreq: 58 + Math.random() * 40,
      duration: 0.95 + Math.random() * 0.4,
      gain: 0.012 + Math.random() * 0.004,
      Q: 6,
      destination: this.ambienceBus,
      waveform: 'triangle',
    });
  }

  _playDistantMoan() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const baseFreq = 64 + Math.random() * 68;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.linearRampToValueAtTime(baseFreq * 0.74, now + 2.2);
    osc.frequency.linearRampToValueAtTime(baseFreq * 0.48, now + 4.2);

    const shadow = this.ctx.createOscillator();
    shadow.type = 'triangle';
    shadow.frequency.setValueAtTime(baseFreq * 0.5, now);
    shadow.frequency.linearRampToValueAtTime(baseFreq * 0.34, now + 4.2);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.012, now + 0.65);
    gain.gain.linearRampToValueAtTime(0.022, now + 2.6);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 4.3);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 180;

    const delay = this.ctx.createDelay();
    delay.delayTime.value = 0.42;
    const fbGain = this.ctx.createGain();
    fbGain.gain.value = 0.24;

    osc.connect(filter);
    shadow.connect(filter);
    filter.connect(gain);
    gain.connect(this.ambienceBus);
    gain.connect(delay);
    delay.connect(fbGain);
    fbGain.connect(delay);
    fbGain.connect(this.ambienceBus);

    osc.start(now);
    shadow.start(now);
    this._playNoiseBurst({
      duration: 3.8,
      gain: 0.004,
      filterType: 'lowpass',
      frequency: 240,
      Q: 0.7,
      buffer: 'brown',
      destination: this.ambienceBus,
      playbackRate: 0.68,
    });
    osc.stop(now + 4.4);
    shadow.stop(now + 4.4);
  }

  playSonar() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this._duckBuses({ music: 0.45, ambience: 0.62, threat: 0.7 }, 0.65, 0.01, 0.8);

    // Sonar ping - classic submarine sound
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1500, now);
    osc.frequency.exponentialRampToValueAtTime(800, now + 0.15);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.5);

    // Echo effect
    const delay1 = this.ctx.createDelay(2.0);
    delay1.delayTime.value = 0.6;
    const echoGain1 = this.ctx.createGain();
    echoGain1.gain.value = 0.15;

    const delay2 = this.ctx.createDelay(2.0);
    delay2.delayTime.value = 1.2;
    const echoGain2 = this.ctx.createGain();
    echoGain2.gain.value = 0.05;

    osc.connect(gain);
    gain.connect(this.uiBus);
    gain.connect(delay1);
    delay1.connect(echoGain1);
    echoGain1.connect(this.uiBus);
    echoGain1.connect(delay2);
    delay2.connect(echoGain2);
    echoGain2.connect(this.uiBus);

    osc.start(now);
    osc.stop(now + 0.15);
  }

  _playHeartbeat(intensity) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const vol = 0.03 * intensity;

    for (const offset of [0, 0.15]) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 40;
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0, now + offset);
      gain.gain.linearRampToValueAtTime(vol, now + offset + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.2);
      osc.connect(gain);
      gain.connect(this.threatBus);
      osc.start(now + offset);
      osc.stop(now + offset + 0.25);

      this._playNoiseBurst({
        duration: 0.12,
        gain: vol * 0.18,
        filterType: 'bandpass',
        frequency: 120,
        Q: 2.4,
        buffer: 'pink',
        destination: this.threatBus,
        delay: offset,
      });
    }
  }

  playEncounterDetected() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this._duckBuses({ music: 0.58, ambience: 0.7, threat: 1, ui: 1 }, 1.1, 0.02, 1.4);

    this._playSubDrop({ startFreq: 86, endFreq: 24, duration: 3.1, gain: 0.05 });
    this._playMetalGroan({ startFreq: 172, endFreq: 48, duration: 2.8, gain: 0.025, Q: 5.6 });
    this._playNoiseBurst({
      duration: 2.6,
      gain: 0.012,
      filterType: 'lowpass',
      frequency: 220,
      Q: 0.75,
      buffer: 'brown',
      destination: this.threatBus,
      playbackRate: 0.72,
    });
    this._playEchoPulse({ frequency: 188, duration: 0.24, gain: 0.012, destination: this.threatBus, delayTime: 0.9, echoGain: 0.16 });
  }

  playEncounterReveal() {
    if (!this.ctx) return;
    this._duckBuses({ music: 0.38, ambience: 0.45, threat: 1, ui: 1 }, 1.8, 0.02, 2.2);

    this._playSubDrop({ startFreq: 64, endFreq: 18, duration: 4.5, gain: 0.07 });
    this._playNoiseBurst({
      duration: 4.8,
      gain: 0.026,
      filterType: 'bandpass',
      frequency: 480,
      Q: 0.85,
      buffer: 'white',
      destination: this.threatBus,
      playbackRate: 0.74,
    });
    this._playNoiseBurst({
      duration: 5.2,
      gain: 0.015,
      filterType: 'lowpass',
      frequency: 180,
      Q: 0.6,
      buffer: 'brown',
      destination: this.threatBus,
      playbackRate: 0.6,
    });

    for (const [startFreq, endFreq, delay] of [[48, 22, 0], [63, 28, 0.12], [94, 36, 0.24], [141, 58, 0.34]]) {
      this._playMetalGroan({
        startFreq,
        endFreq,
        duration: 3.9,
        gain: 0.022,
        Q: 2.8,
        destination: this.threatBus,
        waveform: 'sawtooth',
        delay,
      });
    }

    this._playEchoPulse({ frequency: 246, duration: 0.22, gain: 0.016, destination: this.threatBus, delayTime: 1.25, echoGain: 0.2, delay: 0.2 });
  }

  playEncounterRetreat() {
    if (!this.ctx) return;
    this._duckBuses({ music: 0.76, ambience: 0.85, threat: 0.9 }, 0.45, 0.02, 1.1);

    this._playMetalGroan({
      startFreq: 214,
      endFreq: 74,
      duration: 1.9,
      gain: 0.011,
      Q: 3.2,
      destination: this.uiBus,
      waveform: 'sine',
    });
    this._playNoiseBurst({
      duration: 2.3,
      gain: 0.009,
      filterType: 'bandpass',
      frequency: 340,
      Q: 1.2,
      buffer: 'pink',
      destination: this.uiBus,
      playbackRate: 0.86,
    });
    this._playEchoPulse({ frequency: 210, duration: 0.2, gain: 0.01, destination: this.uiBus, delayTime: 0.82, echoGain: 0.14 });
  }

  update(dt, audioState) {
    if (!this.ctx) return;

    const state = typeof audioState === 'object'
      ? audioState
      : { depth: 0, nearestCreatureDist: Number.POSITIVE_INFINITY };
    const depth = state.depth ?? 0;
    const nearestCreatureDist = state.nearestCreatureDist ?? Number.POSITIVE_INFINITY;
    const depthNorm = clamp01(depth / 850);
    const creatureProx = clamp01(1 - nearestCreatureDist / 60);
    const encounterIntensity = clamp01(state.encounterState?.intensity ?? 0);
    const threat = clamp01(Math.max(creatureProx, encounterIntensity, depthNorm * 0.22));

    if (this.music) {
      this.music.update(dt, state);
    }

    this._updateTextureBed(state);

    for (const drone of this.drones) {
      const depthFactor = Math.max(0.28, 1 - depth / 1050);
      drone.osc.frequency.setTargetAtTime(
        drone.baseFreq * depthFactor * (1 + encounterIntensity * 0.04),
        this.ctx.currentTime,
        1.2
      );
      const volMult = 1 + depthNorm * 0.34 + threat * 0.16 + encounterIntensity * 0.18;
      drone.gain.gain.setTargetAtTime(
        drone.baseVol * volMult,
        this.ctx.currentTime,
        1.2
      );
    }

    this.creakTimer += dt;
    if (this.creakTimer > this.creakInterval) {
      this.creakTimer = 0;
      this.creakInterval = lerp(11, 4.2, depthNorm) + Math.random() * lerp(8, 3, threat);

      if (Math.random() < 0.55 + threat * 0.15) {
        this._playCreak();
      } else {
        this._playDistantMoan();
      }
    }

    if (nearestCreatureDist < 20) {
      const intensity = 1 - nearestCreatureDist / 20;
      if (Math.random() < intensity * dt * (2.4 + encounterIntensity * 1.2)) {
        this._playHeartbeat(intensity);
      }
    }

    this.masterGain.gain.setTargetAtTime(0.44 + encounterIntensity * 0.03, this.ctx.currentTime, 1.8);
  }
}
