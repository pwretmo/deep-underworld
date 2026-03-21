import { MusicSystem } from './MusicSystem.js';

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.started = false;
    this.masterGain = null;
    this.music = null;

    // Oscillator nodes
    this.drones = [];
    this.creakTimer = 0;
    this.creakInterval = 8 + Math.random() * 12;
    this.sonarOsc = null;
  }

  start() {
    if (this.started) return;
    this.ctx = new AudioContext();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.3;
    this.masterGain.connect(this.ctx.destination);
    this.started = true;

    // Deep ambient drone
    this._createDrone(40, 'sine', 0.08);
    this._createDrone(60, 'sine', 0.05);
    this._createDrone(80, 'triangle', 0.03);

    // Sub bass rumble
    this._createDrone(25, 'sine', 0.06);

    // Adaptive music system
    this.music = new MusicSystem(this.ctx, this.masterGain);
    this.music.start();
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
    gain.connect(this.masterGain);
    osc.start();

    this.drones.push({ osc, gain, lfo, baseFreq: freq, baseVol: vol });
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
    gain.connect(this.masterGain);
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
    gain.connect(this.masterGain);
    gain.connect(delay);
    delay.connect(fbGain);
    fbGain.connect(delay);
    fbGain.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + 4);
  }

  playPickup() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    // Ethereal chime — two quick rising tones
    for (const [freq, delay] of [[600, 0], [900, 0.08]]) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + delay);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.5, now + delay + 0.15);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.12, now + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.4);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now + delay);
      osc.stop(now + delay + 0.5);
    }
  }

  playSonar() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    // Sonar ping - classic submarine sound
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1500, now);
    osc.frequency.exponentialRampToValueAtTime(800, now + 0.15);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.5);

    // Echo effect
    const delay1 = this.ctx.createDelay();
    delay1.delayTime.value = 0.6;
    const echoGain1 = this.ctx.createGain();
    echoGain1.gain.value = 0.15;

    const delay2 = this.ctx.createDelay();
    delay2.delayTime.value = 1.2;
    const echoGain2 = this.ctx.createGain();
    echoGain2.gain.value = 0.05;

    osc.connect(gain);
    gain.connect(this.masterGain);
    gain.connect(delay1);
    delay1.connect(echoGain1);
    echoGain1.connect(this.masterGain);
    echoGain1.connect(delay2);
    delay2.connect(echoGain2);
    echoGain2.connect(this.masterGain);

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
      gain.connect(this.masterGain);
      osc.start(now + offset);
      osc.stop(now + offset + 0.25);
    }
  }

  update(dt, depth, nearestCreatureDist, oxygen) {
    if (!this.ctx) return;

    // Update adaptive music
    if (this.music) {
      this.music.update(dt, depth, nearestCreatureDist, oxygen);
    }

    // Adjust drone frequencies based on depth
    for (const drone of this.drones) {
      const depthFactor = Math.max(0.3, 1 - depth / 1000);
      drone.osc.frequency.setTargetAtTime(
        drone.baseFreq * depthFactor,
        this.ctx.currentTime,
        0.5
      );
      // Get louder in deep zones
      const volMult = 1 + (depth / 500) * 0.5;
      drone.gain.gain.setTargetAtTime(
        drone.baseVol * volMult,
        this.ctx.currentTime,
        0.5
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
