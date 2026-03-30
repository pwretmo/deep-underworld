import RAPIER from '@dimforge/rapier3d-compat';

export class PhysicsWorld {
  constructor() {
    this.world = null;
    this.characterController = null;
    this._colliders = new Map(); // handle → collider
    this._bodies = new Map();   // handle → rigidBody
  }

  async init() {
    await RAPIER.init({});
    // Zero gravity — the game handles movement via velocity + drag
    this.world = new RAPIER.World({ x: 0, y: 0, z: 0 });

    // KinematicCharacterController with 0.01 skin width
    this.characterController = this.world.createCharacterController(0.01);
    // Slide along surfaces instead of hard stops
    this.characterController.setSlideEnabled(true);
    // Max slope angle (60 degrees) before the controller can't climb
    this.characterController.setMaxSlopeClimbAngle((60 * Math.PI) / 180);
    // Auto-step for small ledges
    this.characterController.enableAutostep(0.5, 0.2, true);
    // Snap to ground within a small distance to prevent floating
    this.characterController.enableSnapToGround(0.3);
  }

  step(dt) {
    if (!this.world) return;
    this.world.timestep = dt;
    this.world.step();
  }

  /**
   * Create a trimesh collider for terrain geometry.
   * @param {Float32Array} vertices - flattened xyz vertex positions (world-space)
   * @param {Uint32Array} indices - triangle index buffer
   * @returns {number} collider handle for later removal
   */
  createTrimeshCollider(vertices, indices) {
    const bodyDesc = RAPIER.RigidBodyDesc.fixed();
    const body = this.world.createRigidBody(bodyDesc);

    const colliderDesc = RAPIER.ColliderDesc.trimesh(vertices, indices);
    const collider = this.world.createCollider(colliderDesc, body);

    const handle = collider.handle;
    this._colliders.set(handle, collider);
    this._bodies.set(handle, body);
    return handle;
  }

  /**
   * Create a sphere collider for a rock at a given position.
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number} radius
   * @returns {number} collider handle
   */
  createSphereCollider(x, y, z, radius) {
    const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z);
    const body = this.world.createRigidBody(bodyDesc);

    const colliderDesc = RAPIER.ColliderDesc.ball(radius);
    const collider = this.world.createCollider(colliderDesc, body);

    const handle = collider.handle;
    this._colliders.set(handle, collider);
    this._bodies.set(handle, body);
    return handle;
  }

  /**
   * Create many sphere colliders from a flat [x, y, z, radius] array.
   * @param {Float32Array} spheres
   * @returns {number[]} collider handles
   */
  createSphereColliders(spheres) {
    const handles = [];

    for (let i = 0; i + 3 < spheres.length; i += 4) {
      handles.push(
        this.createSphereCollider(
          spheres[i],
          spheres[i + 1],
          spheres[i + 2],
          spheres[i + 3],
        ),
      );
    }

    return handles;
  }

  /**
   * Create a capsule collider for the player (kinematic position-based).
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number} halfHeight
   * @param {number} radius
   * @returns {{ collider: object, body: object }}
   */
  createPlayerCollider(x, y, z, halfHeight, radius) {
    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(x, y, z);
    const body = this.world.createRigidBody(bodyDesc);

    const colliderDesc = RAPIER.ColliderDesc.capsule(halfHeight, radius);
    const collider = this.world.createCollider(colliderDesc, body);

    return { collider, body };
  }

  /**
   * Compute corrected movement for the character controller.
   * @param {object} collider - the player's collider
   * @param {{ x: number, y: number, z: number }} desiredMovement
   * @returns {{ x: number, y: number, z: number }} corrected movement
   */
  computeMovement(collider, desiredMovement) {
    this.characterController.computeColliderMovement(collider, desiredMovement);
    const corrected = this.characterController.computedMovement();
    return { x: corrected.x, y: corrected.y, z: corrected.z };
  }

  /**
   * Remove a collider and its rigid body by handle.
   * @param {number} handle
   */
  removeCollider(handle) {
    const collider = this._colliders.get(handle);
    const body = this._bodies.get(handle);
    if (collider) {
      this.world.removeCollider(collider, true);
      this._colliders.delete(handle);
    }
    if (body) {
      this.world.removeRigidBody(body);
      this._bodies.delete(handle);
    }
  }

  dispose() {
    if (this.world) {
      this.world.free();
      this.world = null;
    }
    this._colliders.clear();
    this._bodies.clear();
  }
}
