import * as THREE from 'three';
import { qualityManager } from '../QualityManager.js';
import {
  createVolumetricBeamMaterial,
  createFallbackBeamMaterial,
  createVolumetricDustMaterial,
} from '../shaders/VolumetricBeamMaterial.js';

// Soft circular particle texture (avoids hard square pixels)
function createDustTexture() {
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,0.8)');
  gradient.addColorStop(0.4, 'rgba(255,255,255,0.3)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

/**
 * Detect if the GPU can handle volumetric shaders.
 * Falls back on OES_standard_derivatives absence or low max texture units.
 */
function canUseVolumetricBeam(renderer) {
  if (!renderer) return false;
  const gl = renderer.getContext();
  if (!gl) return false;
  // Require at least 8 texture units and standard derivatives
  const maxTexUnits = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS);
  if (maxTexUnits < 8) return false;
  // WebGL2 always supports derivatives; for WebGL1, check extension
  if (!gl.getExtension || gl instanceof WebGL2RenderingContext) return true;
  return !!gl.getExtension('OES_standard_derivatives');
}

export class Player {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {HTMLElement} domElement
   * @param {THREE.WebGLRenderer} [renderer] - optional, used for GPU capability detection
   */
  constructor(camera, domElement, renderer) {
    this.camera = camera;
    this.domElement = domElement;
    this.position = camera.position;

    // Movement
    this.velocity = new THREE.Vector3();
    this.moveSpeed = 15;
    this.dampening = 3;
    this.keys = {};

    // Mouse look
    this.euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this.locked = false;
    this.mouseSensitivity = 0.002;

    // Volumetric quality: true = shader-based beam, false = flat fallback
    this._volumetricEnabled = canUseVolumetricBeam(renderer);

    // Submarine flashlight
    this.flashlight = new THREE.Group();
    const spotlight = new THREE.SpotLight(0xccddff, 200, 120, Math.PI / 7, 0.3, 1.4);
    spotlight.position.set(0, 0, 0);
    spotlight.target.position.set(0, 0, -1);
    this.flashlight.add(spotlight);
    this.flashlight.add(spotlight.target);

    // Volumetric light cone — uses shader or flat fallback based on GPU capability
    const coneLength = 50;
    const coneRadius = Math.tan(Math.PI / 7) * coneLength;
    const coneGeo = new THREE.ConeGeometry(coneRadius, coneLength, 32, 8, true);
    coneGeo.translate(0, -coneLength / 2, 0);
    coneGeo.rotateX(Math.PI / 2);

    if (this._volumetricEnabled) {
      this._beamMaterial = createVolumetricBeamMaterial();
      this._beamMaterial.uniforms.beamLength.value = coneLength;
    } else {
      this._beamMaterial = createFallbackBeamMaterial();
    }
    this.lightCone = new THREE.Mesh(coneGeo, this._beamMaterial);
    this.flashlight.add(this.lightCone);

    // Dust particles in the beam
    const dustCount = qualityManager.getSettings().particleCount;
    this._dustConeLength = coneLength;
    this._dustTexture = createDustTexture();
    this._buildDustParticles(dustCount, coneLength);

    this.flashlight.visible = false;
    camera.add(this.flashlight);

    // Rebuild particles on quality change
    window.addEventListener('qualitychange', (e) => {
      this._rebuildDustParticles(e.detail.settings.particleCount);
    });

    // Submarine ambient glow — visible cockpit illumination
    this.subLight = new THREE.PointLight(0x334466, 1.5, 18);
    camera.add(this.subLight);

    /** Current depth (positive = deeper). Updated by Game._animate(). */
    this.depth = 0;

    // Head bobbing
    this.bobTime = 0;
    this.bobAmount = 0.03;

    this._setupControls();
  }

  _buildDustParticles(count, coneLength) {
    const dustGeo = new THREE.BufferGeometry();
    const dustPositions = new Float32Array(count * 3);
    const dustSizes = new Float32Array(count);
    const dustPhases = new Float32Array(count);
    const dustSpeeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const z = -Math.random() * coneLength;
      const maxR = Math.tan(Math.PI / 7) * Math.abs(z) * 0.8;
      const angle = Math.random() * Math.PI * 2;
      const r = Math.random() * maxR;
      dustPositions[i * 3] = Math.cos(angle) * r;
      dustPositions[i * 3 + 1] = Math.sin(angle) * r;
      dustPositions[i * 3 + 2] = z;
      dustSizes[i] = 0.6 + Math.random() * 1.4;
      dustPhases[i] = Math.random();
      const depthT = Math.abs(z) / coneLength;
      dustSpeeds[i] = 0.3 + (1.0 - depthT) * 0.7;
    }
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
    dustGeo.setAttribute('size', new THREE.BufferAttribute(dustSizes, 1));
    dustGeo.setAttribute('phase', new THREE.BufferAttribute(dustPhases, 1));

    if (this._volumetricEnabled) {
      this._dustMaterial = createVolumetricDustMaterial(this._dustTexture);
      this._dustMaterial.uniforms.beamLength.value = coneLength;
    } else {
      this._dustMaterial = new THREE.PointsMaterial({
        color: 0x99aacc,
        size: 0.08,
        map: this._dustTexture,
        transparent: true,
        opacity: 0.35,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
      });
    }

    this.dustParticles = new THREE.Points(dustGeo, this._dustMaterial);
    this.flashlight.add(this.dustParticles);
    this._dustBasePositions = dustPositions.slice();
    this._dustSpeeds = dustSpeeds;
  }

  _rebuildDustParticles(count) {
    if (this.dustParticles) {
      this.flashlight.remove(this.dustParticles);
      this.dustParticles.geometry.dispose();
      this.dustParticles.material.dispose();
    }
    this._buildDustParticles(count, this._dustConeLength);
  }

  _setupControls() {
    document.addEventListener('keydown', (e) => { this.keys[e.code] = true; });
    document.addEventListener('keyup', (e) => { this.keys[e.code] = false; });

    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.euler.setFromQuaternion(this.camera.quaternion);
      this.euler.y -= e.movementX * this.mouseSensitivity;
      this.euler.x -= e.movementY * this.mouseSensitivity;
      this.euler.x = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.euler.x));
      this.camera.quaternion.setFromEuler(this.euler);
    });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.domElement;
      if (this.onLockChange) this.onLockChange(this.locked);
    });
  }

  lock() {
    if (!this.domElement?.requestPointerLock) return false;
    this.domElement.requestPointerLock();
    return true;
  }

  unlock() {
    document.exitPointerLock();
  }

  reset() {
    this.position.set(0, -5, 0);
    this.velocity.set(0, 0, 0);
    this.euler.set(0, 0, 0);
    this.camera.quaternion.setFromEuler(this.euler);
  }

  update(dt) {
    if (!this.locked) return;

    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    const right = new THREE.Vector3().crossVectors(forward, this.camera.up).normalize();
    const up = new THREE.Vector3(0, 1, 0);

    const accel = new THREE.Vector3();

    if (this.keys['KeyW']) accel.add(forward);
    if (this.keys['KeyS']) accel.sub(forward);
    if (this.keys['KeyA']) accel.sub(right);
    if (this.keys['KeyD']) accel.add(right);
    if (this.keys['Space']) accel.add(up);
    if (this.keys['ShiftLeft'] || this.keys['ShiftRight']) accel.sub(up);

    if (accel.length() > 0) {
      accel.normalize().multiplyScalar(this.moveSpeed);
    }

    this.velocity.add(accel.multiplyScalar(dt));
    this.velocity.multiplyScalar(1 - this.dampening * dt);
    this.position.add(this.velocity.clone().multiplyScalar(dt));

    // Keep player below water surface
    if (this.position.y > -1) {
      this.position.y = -1;
      this.velocity.y = 0;
    }

    // Head bobbing effect when moving
    const speed = this.velocity.length();
    if (speed > 0.5) {
      this.bobTime += dt * speed * 0.5;
      const bob = Math.sin(this.bobTime) * this.bobAmount * Math.min(speed / 5, 1);
      this.camera.position.y += bob * dt;
    }

    // Shared time for dust particles and beam shader
    const time = performance.now() * 0.001;

    // Animate dust particles in flashlight beam
    if (this.flashlight.visible && this.dustParticles) {
      const pos = this.dustParticles.geometry.attributes.position;

      for (let i = 0; i < pos.count; i++) {
        const bx = this._dustBasePositions[i * 3];
        const by = this._dustBasePositions[i * 3 + 1];
        const bz = this._dustBasePositions[i * 3 + 2];
        const spd = this._dustSpeeds[i];

        // Turbulent drift: speed varies per particle, deeper ones drift slower
        pos.setX(i, bx + Math.sin(time * 0.3 * spd + i * 0.7) * 0.18 * spd);
        pos.setY(i, by + Math.cos(time * 0.4 * spd + i * 0.5) * 0.18 * spd);
        pos.setZ(i, bz + Math.sin(time * 0.2 * spd + i * 0.3) * 0.12 * spd);
      }
      pos.needsUpdate = true;

      // Update volumetric dust shader time
      if (this._volumetricEnabled && this._dustMaterial.uniforms) {
        this._dustMaterial.uniforms.time.value = time;
      }
    }

    // Update volumetric beam shader uniforms
    if (this.flashlight.visible && this._volumetricEnabled && this._beamMaterial.uniforms) {
      this._beamMaterial.uniforms.time.value = time;
    }
  }

  /**
   * Sync fog uniforms from the scene fog so the beam and particles fade properly.
   * Called by Game._animate() each frame when flashlight is on.
   * @param {THREE.Fog} fog
   */
  updateFogUniforms(fog) {
    if (!this._volumetricEnabled || !fog) return;
    const beamU = this._beamMaterial.uniforms;
    beamU.fogColor.value.copy(fog.color);
    beamU.fogNear.value = fog.near;
    beamU.fogFar.value = fog.far;

    if (this._dustMaterial.uniforms) {
      const dustU = this._dustMaterial.uniforms;
      dustU.fogColor.value.copy(fog.color);
      dustU.fogNear.value = fog.near;
      dustU.fogFar.value = fog.far;
    }
  }
}
