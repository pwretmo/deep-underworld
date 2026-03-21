import * as THREE from 'three';

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

export class Player {
  constructor(camera, domElement) {
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

    // Submarine flashlight
    this.flashlight = new THREE.Group();
    const spotlight = new THREE.SpotLight(0xccddff, 50, 80, Math.PI / 7, 0.3, 1.8);
    spotlight.castShadow = true;
    spotlight.shadow.mapSize.set(1024, 1024);
    spotlight.position.set(0, 0, 0);
    spotlight.target.position.set(0, 0, -1);
    this.flashlight.add(spotlight);
    this.flashlight.add(spotlight.target);

    // Volumetric light cone
    const coneLength = 50;
    const coneRadius = Math.tan(Math.PI / 7) * coneLength;
    const coneGeo = new THREE.ConeGeometry(coneRadius, coneLength, 32, 1, true);
    coneGeo.translate(0, -coneLength / 2, 0);
    coneGeo.rotateX(Math.PI / 2);
    this.lightCone = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({
      color: 0x8899bb,
      transparent: true,
      opacity: 0.018,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    }));
    this.flashlight.add(this.lightCone);

    // Dust particles in the beam
    const dustCount = 500;
    const dustGeo = new THREE.BufferGeometry();
    const dustPositions = new Float32Array(dustCount * 3);
    const dustSizes = new Float32Array(dustCount);
    for (let i = 0; i < dustCount; i++) {
      const z = -Math.random() * coneLength;
      const maxR = Math.tan(Math.PI / 7) * Math.abs(z) * 0.8;
      const angle = Math.random() * Math.PI * 2;
      const r = Math.random() * maxR;
      dustPositions[i * 3] = Math.cos(angle) * r;
      dustPositions[i * 3 + 1] = Math.sin(angle) * r;
      dustPositions[i * 3 + 2] = z;
      dustSizes[i] = 0.05 + Math.random() * 0.12;
    }
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
    dustGeo.setAttribute('size', new THREE.BufferAttribute(dustSizes, 1));
    const dustTexture = createDustTexture();
    this.dustParticles = new THREE.Points(dustGeo, new THREE.PointsMaterial({
      color: 0x99aacc,
      size: 0.08,
      map: dustTexture,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    }));
    this.flashlight.add(this.dustParticles);
    this._dustBasePositions = dustPositions.slice();
    this._dustConeLength = coneLength;

    this.flashlight.visible = false;
    camera.add(this.flashlight);

    // Submarine ambient glow - dimmer for more contrast
    this.subLight = new THREE.PointLight(0x112233, 0.2, 5);
    camera.add(this.subLight);

    /** Current depth (positive = deeper). Updated by Game._animate(). */
    this.depth = 0;

    // Head bobbing
    this.bobTime = 0;
    this.bobAmount = 0.03;

    this._setupControls();
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

    // Animate dust particles in flashlight beam
    if (this.flashlight.visible && this.dustParticles) {
      const pos = this.dustParticles.geometry.attributes.position;
      const time = performance.now() * 0.001;
      for (let i = 0; i < pos.count; i++) {
        const bx = this._dustBasePositions[i * 3];
        const by = this._dustBasePositions[i * 3 + 1];
        const bz = this._dustBasePositions[i * 3 + 2];
        pos.setX(i, bx + Math.sin(time * 0.3 + i * 0.7) * 0.15);
        pos.setY(i, by + Math.cos(time * 0.4 + i * 0.5) * 0.15);
        pos.setZ(i, bz + Math.sin(time * 0.2 + i * 0.3) * 0.1);
      }
      pos.needsUpdate = true;
    }
  }
}
