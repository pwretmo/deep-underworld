import { MusicSystem } from './MusicSystem.js';

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.started = false;
    this.masterGain = null;
    this.ambienceBus = null;
    this.musicBus = null;
    this.threatBus = null;
    this.uiBus = null;
    this.music = null;
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

  start() {
    if (this.started) return;
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AudioContextCtor();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.4;
    this.masterGain.connect(this.ctx.destination);
    this.ambienceBus = this._createBus(this.busDefaults.ambience);
    this.musicBus = this._createBus(this.busDefaults.music);
    this.threatBus = this._createBus(this.busDefaults.threat);
    this.uiBus = this._createBus(this.busDefaults.ui);
    this.started = true;

    // Deep ambient drone
    this._createDrone(38, 'sine', 0.05);
    this._createDrone(54, 'sine', 0.03);
    this._createDrone(76, 'triangle', 0.015);

    // Sub bass rumble
    this._createDrone(24, 'sine', 0.035);

    // Adaptive music system
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

  _playCreak() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(200 + Math.random() * 300, now);
    osc.frequency.exponentialRampToValueAtTime(50 + Math.random() * 100, now + 0.5);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.02 + Math.random() * 0.02, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5 + Math.random() * 0.5);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 300 + Math.random() * 500;
    filter.Q.value = 5;

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.ambienceBus);
    osc.start(now);
    osc.stop(now + 1);
  }

  _playDistantMoan() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    const baseFreq = 80 + Math.random() * 120;
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.linearRampToValueAtTime(baseFreq * 0.7, now + 2);
    osc.frequency.linearRampToValueAtTime(baseFreq * 0.5, now + 4);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.015, now + 0.5);
    gain.gain.linearRampToValueAtTime(0.02, now + 2);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 4);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 200;

    const reverb = this.ctx.createConvolver();
    // Simple reverb via delay
    const delay = this.ctx.createDelay();
    delay.delayTime.value = 0.3;
    const fbGain = this.ctx.createGain();
    fbGain.gain.value = 0.3;

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.ambienceBus);
    gain.connect(delay);
    delay.connect(fbGain);
    fbGain.connect(delay);
    fbGain.connect(this.ambienceBus);

    osc.start(now);
    osc.stop(now + 4);
  }

  playPickup() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this._duckBuses({ music: 0.72, ambience: 0.8, threat: 0.85 }, 0.35, 0.01, 0.4);

    // Focused confirmation ping that cuts without sounding arcade-like.
    for (const [freq, delay, type] of [[420, 0, 'triangle'], [620, 0.09, 'sine'], [880, 0.18, 'sine']]) {
      const osc = this.ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now + delay);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.18, now + delay + 0.22);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.07, now + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.55);

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = freq * 1.6;
      filter.Q.value = 2.5;

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.uiBus);
      osc.start(now + delay);
      osc.stop(now + delay + 0.65);
    }
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

    // Two-beat pattern
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
    }
  }

  playEncounterDetected() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this._duckBuses({ music: 0.58, ambience: 0.7, threat: 1, ui: 1 }, 1.1, 0.02, 1.4);

    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(170, now);
    osc.frequency.exponentialRampToValueAtTime(62, now + 2.8);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.04, now + 0.25);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 2.9);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 240;

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.threatBus);
    osc.start(now);
    osc.stop(now + 3);
  }

  playEncounterReveal() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this._duckBuses({ music: 0.38, ambience: 0.45, threat: 1, ui: 1 }, 1.8, 0.02, 2.2);

    for (const [freq, delay, detune] of [[52, 0, -8], [78, 0.08, 0], [117, 0.14, 7]]) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.detune.value = detune;
      osc.frequency.setValueAtTime(freq, now + delay);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.55, now + delay + 3.4);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now + delay);
      gain.gain.exponentialRampToValueAtTime(0.035, now + delay + 0.2);
      gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 3.5);

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = freq * 4;
      filter.Q.value = 1.8;

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.threatBus);
      osc.start(now + delay);
      osc.stop(now + delay + 3.7);
    }
  }

  playEncounterRetreat() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this._duckBuses({ music: 0.76, ambience: 0.85, threat: 0.9 }, 0.45, 0.02, 1.1);

    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(240, now);
    osc.frequency.exponentialRampToValueAtTime(110, now + 1.6);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.02, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.8);

    osc.connect(gain);
    gain.connect(this.uiBus);
    osc.start(now);
    osc.stop(now + 1.9);
  }

  update(dt, audioState) {
    if (!this.ctx) return;

    const state = typeof audioState === 'object'
      ? audioState
      : { depth: 0, nearestCreatureDist: Number.POSITIVE_INFINITY };
    const depth = state.depth ?? 0;
    const nearestCreatureDist = state.nearestCreatureDist ?? Number.POSITIVE_INFINITY;

    // Update adaptive music
    if (this.music) {
      this.music.update(dt, state);
    }

    // Adjust drone frequencies based on depth
    for (const drone of this.drones) {
      const depthFactor = Math.max(0.3, 1 - depth / 1000);
      drone.osc.frequency.setTargetAtTime(
        drone.baseFreq * depthFactor,
        this.ctx.currentTime,
        1.2
      );
      // Get louder in deep zones
      const encounterIntensity = state.encounterState?.intensity ?? 0;
      const volMult = 1 + (depth / 700) * 0.28 + encounterIntensity * 0.18;
      drone.gain.gain.setTargetAtTime(
        drone.baseVol * volMult,
        this.ctx.currentTime,
        1.2
      );
    }

    // Random creaks and groans
    this.creakTimer += dt;
    if (this.creakTimer > this.creakInterval) {
      this.creakTimer = 0;
      this.creakInterval = 5 + Math.random() * (depth > 200 ? 5 : 15);

      if (Math.random() < 0.6) {
        this._playCreak();
      } else {
        this._playDistantMoan();
      }
    }

    // Heartbeat when creature is very close
    if (nearestCreatureDist < 20) {
      const intensity = 1 - nearestCreatureDist / 20;
      if (Math.random() < intensity * dt * 2) {
        this._playHeartbeat(intensity);
      }
    }
  }
}
