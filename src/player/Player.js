import * as THREE from "three";
import { ExternalLightingSystem } from "./ExternalLightingSystem.js";

/**
 * Detect if the GPU can handle volumetric shaders.
 * Only enable the shader path once a WebGL backend is initialized and has the
 * required capabilities. WebGPU and pre-init paths stay on the flat fallback.
 */
function canUseVolumetricBeam(renderer) {
  if (!renderer) return false;
  const backend = renderer.backend;
  if (!backend || !backend.isWebGLBackend) return false;
  // WebGL fallback — check capabilities on the raw GL context
  const gl = backend.gl;
  if (!gl) return false;
  const maxTexUnits = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS);
  if (maxTexUnits < 8) return false;
  if (
    typeof WebGL2RenderingContext !== "undefined" &&
    gl instanceof WebGL2RenderingContext
  ) {
    return true;
  }
  if (!gl.getExtension) return false;
  return !!gl.getExtension("OES_standard_derivatives");
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
    this.autoplayInput = { forward: 0, right: 0, vertical: 0 };
    this.autoplayCollisionBypassTimer = 0;

    // Mouse look
    this.euler = new THREE.Euler(0, 0, 0, "YXZ");
    this.locked = false;
    this.mouseSensitivity = 0.002;

    // Volumetric quality: true = shader-based beam, false = flat fallback
    this._volumetricEnabled = canUseVolumetricBeam(renderer);

    this.externalLighting = new ExternalLightingSystem({
      volumetricEnabled: this._volumetricEnabled,
    });
    this.flashlight = this.externalLighting.group;
    this.hullLights = this.externalLighting.hullLightsGroup;

    this.flashlight.visible = false;
    camera.add(this.flashlight);
    camera.add(this.hullLights);

    // Submarine ambient glow — visible cockpit illumination
    this.subLight = new THREE.PointLight(0x445577, 8, 65);
    camera.add(this.subLight);

    /** Current depth (positive = deeper). Updated by Game._animate(). */
    this.depth = 0;

    // Reusable vectors for update() — avoids per-frame allocations
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this._accel = new THREE.Vector3();

    // Head bobbing
    this.bobTime = 0;
    this.bobAmount = 0.03;

    // Physics (set later via setPhysicsWorld)
    this._physicsWorld = null;
    this._physicsCollider = null;
    this._physicsBody = null;

    this._setupControls();
  }

  configureRenderer(renderer) {
    const volumetricEnabled = canUseVolumetricBeam(renderer);
    if (volumetricEnabled === this._volumetricEnabled) {
      return this._volumetricEnabled;
    }

    this._volumetricEnabled = volumetricEnabled;
    this.externalLighting.setVolumetricEnabled(volumetricEnabled);
    return this._volumetricEnabled;
  }

  _setupControls() {
    document.addEventListener("keydown", (e) => {
      this.keys[e.code] = true;
    });
    document.addEventListener("keyup", (e) => {
      this.keys[e.code] = false;
    });

    document.addEventListener("mousemove", (e) => {
      if (!this.locked) return;
      this.euler.setFromQuaternion(this.camera.quaternion);
      this.euler.y -= e.movementX * this.mouseSensitivity;
      this.euler.x -= e.movementY * this.mouseSensitivity;
      this.euler.x = Math.max(
        -Math.PI / 2 + 0.01,
        Math.min(Math.PI / 2 - 0.01, this.euler.x),
      );
      this.camera.quaternion.setFromEuler(this.euler);
    });

    document.addEventListener("pointerlockchange", () => {
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

  /**
   * Attach physics world and create the player's capsule collider.
   * @param {import('../physics/PhysicsWorld.js').PhysicsWorld} physicsWorld
   */
  setPhysicsWorld(physicsWorld) {
    this._physicsWorld = physicsWorld;
    const { collider, body } = physicsWorld.createPlayerCollider(
      this.position.x,
      this.position.y,
      this.position.z,
      1, // half-height
      2, // radius
    );
    this._physicsCollider = collider;
    this._physicsBody = body;
  }

  reset() {
    this.position.set(0, -5, 0);
    this.velocity.set(0, 0, 0);
    this.clearAutoplayInput();
    this.autoplayCollisionBypassTimer = 0;
    this.euler.set(0, 0, 0);
    this.camera.quaternion.setFromEuler(this.euler);
    // Sync physics body to reset position
    if (this._physicsBody) {
      this._physicsBody.setNextKinematicTranslation({ x: 0, y: -5, z: 0 });
    }
  }

  setAutoplayInput(input) {
    const forward = input?.forward ?? 0;
    const right = input?.right ?? 0;
    const vertical = input?.vertical ?? 0;

    this.autoplayInput.forward = THREE.MathUtils.clamp(forward, -1, 1);
    this.autoplayInput.right = THREE.MathUtils.clamp(right, -1, 1);
    this.autoplayInput.vertical = THREE.MathUtils.clamp(vertical, -1, 1);
  }

  clearAutoplayInput() {
    this.autoplayInput.forward = 0;
    this.autoplayInput.right = 0;
    this.autoplayInput.vertical = 0;
  }

  update(dt) {
    if (!this.locked) return;

    this.camera.getWorldDirection(this._forward);
    this._right.crossVectors(this._forward, this.camera.up).normalize();
    this._up.set(0, 1, 0);

    this._accel.set(0, 0, 0);

    const forwardInput = THREE.MathUtils.clamp(
      (this.keys["KeyW"] ? 1 : 0) -
        (this.keys["KeyS"] ? 1 : 0) +
        this.autoplayInput.forward,
      -1,
      1,
    );
    const rightInput = THREE.MathUtils.clamp(
      (this.keys["KeyD"] ? 1 : 0) -
        (this.keys["KeyA"] ? 1 : 0) +
        this.autoplayInput.right,
      -1,
      1,
    );
    const verticalInput = THREE.MathUtils.clamp(
      (this.keys["Space"] ? 1 : 0) -
        (this.keys["ShiftLeft"] || this.keys["ShiftRight"] ? 1 : 0) +
        this.autoplayInput.vertical,
      -1,
      1,
    );

    if (forwardInput !== 0)
      this._accel.addScaledVector(this._forward, forwardInput);
    if (rightInput !== 0) this._accel.addScaledVector(this._right, rightInput);
    if (verticalInput !== 0)
      this._accel.addScaledVector(this._up, verticalInput);

    if (this._accel.length() > 0) {
      this._accel.normalize().multiplyScalar(this.moveSpeed);
    }

    this.velocity.add(this._accel.multiplyScalar(dt));
    this.velocity.multiplyScalar(1 - this.dampening * dt);

    // Compute desired movement delta
    const dx = this.velocity.x * dt;
    const dy = this.velocity.y * dt;
    const dz = this.velocity.z * dt;
    if (this.autoplayCollisionBypassTimer > 0) {
      this.autoplayCollisionBypassTimer = Math.max(
        0,
        this.autoplayCollisionBypassTimer - dt,
      );
    }
    const bypassCollisions = this.autoplayCollisionBypassTimer > 0;

    // Use physics character controller if available
    if (
      this._physicsWorld &&
      this._physicsCollider &&
      this._physicsBody &&
      !bypassCollisions
    ) {
      const corrected = this._physicsWorld.computeMovement(
        this._physicsCollider,
        { x: dx, y: dy, z: dz },
      );
      this.position.x += corrected.x;
      this.position.y += corrected.y;
      this.position.z += corrected.z;

      // If movement was blocked on an axis, zero that velocity component
      // to prevent velocity buildup against walls
      const tolerance = 0.001;
      if (Math.abs(dx) > tolerance && Math.abs(corrected.x) < tolerance)
        this.velocity.x = 0;
      if (Math.abs(dy) > tolerance && Math.abs(corrected.y) < tolerance)
        this.velocity.y = 0;
      if (Math.abs(dz) > tolerance && Math.abs(corrected.z) < tolerance)
        this.velocity.z = 0;

      // Sync kinematic body to new position
      this._physicsBody.setNextKinematicTranslation({
        x: this.position.x,
        y: this.position.y,
        z: this.position.z,
      });
    } else {
      // Fallback: no physics, apply raw movement
      this.position.x += dx;
      this.position.y += dy;
      this.position.z += dz;
    }

    // Keep player below water surface (post-physics constraint)
    if (this.position.y > -1) {
      this.position.y = -1;
      this.velocity.y = 0;
    }

    // Head bobbing effect when moving
    const speed = this.velocity.length();
    if (speed > 0.5) {
      this.bobTime += dt * speed * 0.5;
      const bob =
        Math.sin(this.bobTime) * this.bobAmount * Math.min(speed / 5, 1);
      this.camera.position.y += bob * dt;
    }

    this.externalLighting.setEnabled(this.flashlight.visible);

    // Shared time for beam shader animation
    const time = performance.now() * 0.001;
    this.externalLighting.update(dt, this.depth, time);
  }

  /**
   * Sync fog uniforms from the scene fog so the beam and particles fade properly.
   * Called by Game._animate() each frame when flashlight is on.
   * @param {THREE.Fog} fog
   */
  updateFogUniforms(fog) {
    if (!fog) return;
    this.externalLighting.updateFogUniforms(fog);
  }
}
