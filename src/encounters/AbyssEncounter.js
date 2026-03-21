import * as THREE from 'three';

// States for the encounter state machine
const State = {
  IDLE: 'IDLE',
  TRIGGERED: 'TRIGGERED',
  FOG_CLOSING: 'FOG_CLOSING',
  REVEAL: 'REVEAL',
  DRIFT: 'DRIFT',
  RETREAT: 'RETREAT',
  COMPLETE: 'COMPLETE',
};

const TRIGGER_DEPTH = 650;
const FOG_CLOSE_DURATION = 3.0;
const REVEAL_DURATION = 5.0;
const DRIFT_DURATION = 20.0;
const RETREAT_DURATION = 6.0;

/**
 * Scripted cinematic encounter: a colossal abyss entity drifts past the tiny sub.
 * Triggers once per session when the player reaches ~650m depth.
 */
export class AbyssEncounter {
  constructor() {
    this.state = State.IDLE;
    this.stateTime = 0;
    this.completed = false;
    this.entity = null;
    this.entityLights = [];

    // Saved environment values to restore after encounter
    this._savedFogNear = 0;
    this._savedFogFar = 0;
    this._savedFogColor = new THREE.Color();
    this._savedAmbientIntensity = 0;

    // Per-frame environment values (written by _updateEnvironmentForDepth before our update)
    this._envFogNear = 0;
    this._envFogFar = 0;
    this._envAmbient = 0;

    // Encounter fog targets
    this._closedFogNear = 1;
    this._closedFogFar = 60;

    // Entity animation state
    this._entityStartPos = new THREE.Vector3();
    this._entityEndPos = new THREE.Vector3();
    this._entityDriftDir = new THREE.Vector3();
  }

  update(delta, depth, player, scene, fog, ambientLight, hud, audio) {
    if (this.completed) return;

    this.stateTime += delta;

    // Capture the environment's intended values each frame (set before us by _updateEnvironmentForDepth)
    // These serve as restoration targets during RETREAT
    if (this.state !== State.IDLE) {
      this._envFogNear = fog.near;
      this._envFogFar = fog.far;
      this._envAmbient = ambientLight.intensity;
    }

    switch (this.state) {
      case State.IDLE:
        this._updateIdle(depth, player, scene, fog, ambientLight, hud);
        break;
      case State.TRIGGERED:
        this._updateTriggered(delta, scene, fog, ambientLight, hud, audio);
        break;
      case State.FOG_CLOSING:
        this._updateFogClosing(delta, fog, ambientLight, hud, audio);
        break;
      case State.REVEAL:
        this._updateReveal(delta, fog, ambientLight);
        break;
      case State.DRIFT:
        this._updateDrift(delta, fog, ambientLight, audio);
        break;
      case State.RETREAT:
        this._updateRetreat(delta, scene, fog, ambientLight);
        break;
    }

    // Animate entity if it exists
    if (this.entity) {
      this._animateEntity(delta);
    }
  }

  // --- State handlers ---

  _updateIdle(depth, player, scene, fog, ambientLight, hud) {
    if (depth >= TRIGGER_DEPTH) {
      this._transition(State.TRIGGERED);
      // Save current environment state
      this._savedFogNear = fog.near;
      this._savedFogFar = fog.far;
      this._savedFogColor.copy(fog.color);
      this._savedAmbientIntensity = ambientLight.intensity;

      // Spawn entity ahead and below the player
      this._spawnEntity(scene, player);
    }
  }

  _updateTriggered(delta, scene, fog, ambientLight, hud, audio) {
    // Immediate transition to fog closing — brief pause for dramatic effect
    if (this.stateTime > 0.5) {
      hud._showWarning('MASSIVE ENTITY DETECTED', 4000);
      audio?.playEncounterDetected();
      this._transition(State.FOG_CLOSING);
    }
  }

  _updateFogClosing(delta, fog, ambientLight, hud, audio) {
    const t = Math.min(this.stateTime / FOG_CLOSE_DURATION, 1);
    const ease = t * t; // ease-in

    // Tighten fog dramatically
    fog.near = THREE.MathUtils.lerp(this._savedFogNear, this._closedFogNear, ease);
    fog.far = THREE.MathUtils.lerp(this._savedFogFar, this._closedFogFar, ease);

    // Reduce ambient light to near-zero
    ambientLight.intensity = THREE.MathUtils.lerp(this._savedAmbientIntensity, 0.001, ease);

    if (t >= 1) {
      audio?.playEncounterReveal();
      this._transition(State.REVEAL);
    }
  }

  _updateReveal(delta, fog, ambientLight) {
    const t = Math.min(this.stateTime / REVEAL_DURATION, 1);
    const ease = t * t * (3 - 2 * t); // smoothstep

    // Gradually widen fog to reveal the entity's scale
    fog.near = THREE.MathUtils.lerp(this._closedFogNear, this._savedFogNear * 0.5, ease);
    fog.far = THREE.MathUtils.lerp(this._closedFogFar, this._savedFogFar * 0.8, ease);

    // Pulse bioluminescence on the entity
    this._pulseBioluminescence(t);

    // Slightly raise ambient so silhouette is visible
    ambientLight.intensity = THREE.MathUtils.lerp(0.001, 0.008, ease);

    if (t >= 1) {
      this._transition(State.DRIFT);
    }
  }

  _updateDrift(delta, fog, ambientLight, audio) {
    const t = Math.min(this.stateTime / DRIFT_DURATION, 1);
    const ease = t * t * (3 - 2 * t);

    // Entity drifts past — move along drift direction
    this.entity.position.lerpVectors(this._entityStartPos, this._entityEndPos, ease);

    // Slowly widen fog further during drift
    fog.near = THREE.MathUtils.lerp(this._savedFogNear * 0.5, this._savedFogNear * 0.7, ease);
    fog.far = THREE.MathUtils.lerp(this._savedFogFar * 0.8, this._savedFogFar * 0.9, ease);

    // Gradually restore ambient
    ambientLight.intensity = THREE.MathUtils.lerp(0.008, this._savedAmbientIntensity * 0.5, ease);

    // Keep pulsing bioluminescence
    this._pulseBioluminescence(0.5 + t * 0.5);

    if (t >= 1) {
      audio?.playEncounterRetreat();
      this._transition(State.RETREAT);
    }
  }

  _updateRetreat(delta, scene, fog, ambientLight) {
    const t = Math.min(this.stateTime / RETREAT_DURATION, 1);
    const ease = t * t * (3 - 2 * t);

    // Entity continues drifting away and fades
    const retreatEnd = this._entityEndPos.clone().add(
      this._entityDriftDir.clone().multiplyScalar(200)
    );
    this.entity.position.lerpVectors(this._entityEndPos, retreatEnd, ease);

    // Fade entity opacity
    this.entity.traverse((child) => {
      if (child.isMesh && child.material && child.material.opacity !== undefined) {
        child.material.opacity = 1 - ease;
      }
    });

    // Dim entity lights
    for (const light of this.entityLights) {
      light.intensity = light.userData.baseIntensity * (1 - ease);
    }

    // Restore environment toward current depth-appropriate values
    fog.near = THREE.MathUtils.lerp(this._savedFogNear * 0.7, this._envFogNear, ease);
    fog.far = THREE.MathUtils.lerp(this._savedFogFar * 0.9, this._envFogFar, ease);
    ambientLight.intensity = THREE.MathUtils.lerp(
      this._savedAmbientIntensity * 0.5, this._envAmbient, ease
    );

    if (t >= 1) {
      // Clean up entity from scene
      this._despawnEntity(scene);
      this.state = State.COMPLETE;
      this.completed = true;
    }
  }

  // --- Entity creation ---

  _spawnEntity(scene, player) {
    this.entity = new THREE.Group();
    this._buildAbyssEntity();

    // Position entity ahead and below the player
    const playerDir = new THREE.Vector3(0, 0, -1);
    playerDir.applyQuaternion(player.camera ? player.camera.quaternion : player.quaternion || new THREE.Quaternion());
    playerDir.y = 0;
    if (playerDir.lengthSq() < 0.01) playerDir.set(0, 0, -1);
    playerDir.normalize();

    const spawnOffset = playerDir.clone().multiplyScalar(120);
    spawnOffset.y = -40; // below player

    this._entityStartPos.copy(player.position).add(spawnOffset);
    this.entity.position.copy(this._entityStartPos);

    // Drift direction: perpendicular to player facing, crossing their view
    this._entityDriftDir.set(-playerDir.z, -0.02, playerDir.x).normalize();
    this._entityEndPos.copy(this._entityStartPos).add(
      this._entityDriftDir.clone().multiplyScalar(300)
    );

    // Face the drift direction
    this.entity.lookAt(this._entityEndPos);

    scene.add(this.entity);
  }

  _buildAbyssEntity() {
    // Dark biomechanical material for main body
    const bodyMat = new THREE.MeshPhysicalMaterial({
      color: 0x040408,
      roughness: 0.15,
      metalness: 0.7,
      clearcoat: 1.0,
      clearcoatRoughness: 0.1,
      transparent: true,
      opacity: 1,
    });

    // Bioluminescent vein material
    const veinMat = new THREE.MeshPhysicalMaterial({
      color: 0x001122,
      emissive: 0x0044ff,
      emissiveIntensity: 2.0,
      roughness: 0.1,
      metalness: 0.3,
      transparent: true,
      opacity: 1,
    });
    this._veinMat = veinMat;

    // Eye material — deep red/orange glow
    const eyeMat = new THREE.MeshPhysicalMaterial({
      color: 0xff2200,
      emissive: 0xff3300,
      emissiveIntensity: 4,
      roughness: 0.0,
      clearcoat: 1.0,
      transparent: true,
      opacity: 1,
    });

    // --- Main body: colossal elongated ellipsoid (~250 units long) ---
    const bodyGeo = new THREE.SphereGeometry(25, 32, 24);
    bodyGeo.scale(5, 1, 1.2); // 250 long, 50 tall, 60 wide
    const bp = bodyGeo.attributes.position;
    for (let i = 0; i < bp.count; i++) {
      const x = bp.getX(i), y = bp.getY(i), z = bp.getZ(i);
      // Taper at head and tail
      const taper = 1 - Math.pow(Math.abs(x) / 125, 3) * 0.4;
      bp.setY(i, y * taper);
      bp.setZ(i, z * taper);
      // Biomechanical surface ribbing
      bp.setY(i, bp.getY(i) + Math.sin(x * 0.3 + z * 0.5) * 0.8);
    }
    bodyGeo.computeVertexNormals();
    this.entity.add(new THREE.Mesh(bodyGeo, bodyMat));

    // --- Dorsal ridge: exposed plating ---
    const ridgeGeo = new THREE.BoxGeometry(200, 4, 1.5, 60, 1, 1);
    const rp = ridgeGeo.attributes.position;
    for (let i = 0; i < rp.count; i++) {
      const x = rp.getX(i), y = rp.getY(i);
      rp.setY(i, y + Math.sin(x * 0.08) * 3 + 20);
      // Taper at edges
      const edgeFade = 1 - Math.pow(Math.abs(x) / 100, 4);
      rp.setY(i, rp.getY(i) * Math.max(0, edgeFade));
    }
    ridgeGeo.computeVertexNormals();
    this.entity.add(new THREE.Mesh(ridgeGeo, bodyMat));

    // --- Bioluminescent vein lines along body ---
    for (let i = 0; i < 12; i++) {
      const veinGeo = new THREE.CylinderGeometry(0.3, 0.3, 180 + Math.random() * 40, 8, 30);
      const vp = veinGeo.attributes.position;
      for (let v = 0; v < vp.count; v++) {
        const y = vp.getY(v);
        // Undulate the veins across the body surface
        vp.setX(v, vp.getX(v) + Math.sin(y * 0.05 + i) * 2);
        vp.setZ(v, vp.getZ(v) + Math.cos(y * 0.03 + i * 0.7) * 1.5);
      }
      veinGeo.computeVertexNormals();
      const vein = new THREE.Mesh(veinGeo, veinMat.clone());
      const angle = (i / 12) * Math.PI * 2;
      const radius = 18 + Math.random() * 6;
      vein.position.set(
        0,
        Math.sin(angle) * radius,
        Math.cos(angle) * radius
      );
      vein.rotation.z = Math.PI / 2; // align veins lengthwise
      this.entity.add(vein);
    }

    // --- Eyes: multiple large glowing eyes along flanks ---
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < 5; i++) {
        const eyeGeo = new THREE.SphereGeometry(1.5 + Math.random() * 1, 16, 16);
        eyeGeo.scale(1.3, 0.6, 1);
        const eye = new THREE.Mesh(eyeGeo, eyeMat.clone());
        const xPos = -60 + i * 30 + (Math.random() - 0.5) * 10;
        eye.position.set(xPos, 10 + Math.random() * 5, side * (22 + Math.random() * 4));
        this.entity.add(eye);

        // Eye glow light
        if (i % 2 === 0) {
          const eyeLight = new THREE.PointLight(0xff3300, 3, 40);
          eyeLight.position.copy(eye.position);
          eyeLight.userData.baseIntensity = 3;
          this.entity.add(eyeLight);
          this.entityLights.push(eyeLight);
        }
      }
    }

    // --- Bioluminescent point lights along body ---
    const bioColors = [0x0044ff, 0x0066cc, 0x2244ff, 0x0088ff];
    for (let i = 0; i < 4; i++) {
      const bioLight = new THREE.PointLight(bioColors[i], 5, 80);
      bioLight.position.set(
        -80 + i * 50,
        -5 + Math.random() * 10,
        (Math.random() - 0.5) * 30
      );
      bioLight.userData.baseIntensity = 5;
      this.entity.add(bioLight);
      this.entityLights.push(bioLight);
    }

    // --- Trailing tendrils/appendages ---
    const tendrilMat = new THREE.MeshPhysicalMaterial({
      color: 0x060610,
      roughness: 0.2,
      metalness: 0.5,
      clearcoat: 0.8,
      transparent: true,
      opacity: 1,
    });

    for (let t = 0; t < 8; t++) {
      const segCount = 15;
      const tendrilGroup = new THREE.Group();
      const angle = (t / 8) * Math.PI * 1.5 - Math.PI * 0.75;
      const baseX = -100 + (Math.random() - 0.5) * 30;
      const baseY = Math.sin(angle) * 15;
      const baseZ = Math.cos(angle) * 20;

      for (let s = 0; s < segCount; s++) {
        const frac = s / segCount;
        const radius = THREE.MathUtils.lerp(2.5, 0.3, frac);
        const segGeo = new THREE.SphereGeometry(radius, 8, 6);
        segGeo.scale(2, 1, 1);
        const seg = new THREE.Mesh(segGeo, tendrilMat.clone());
        seg.position.set(
          -s * 6,
          Math.sin(s * 0.5 + t) * 3 * frac,
          Math.cos(s * 0.4 + t * 0.7) * 2 * frac
        );
        tendrilGroup.add(seg);
      }

      tendrilGroup.position.set(baseX, baseY, baseZ);
      this.entity.add(tendrilGroup);
    }

    // Scale entity — already built at ~250 unit scale
    this.entity.scale.set(1, 1, 1);
  }

  _despawnEntity(scene) {
    if (!this.entity) return;

    // Dispose geometry and materials
    this.entity.traverse((child) => {
      if (child.isMesh) {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (child.material.map) child.material.map.dispose();
          child.material.dispose();
        }
      }
    });

    scene.remove(this.entity);
    this.entity = null;
    this.entityLights = [];
    this._veinMat = null;
  }

  // --- Animation ---

  _animateEntity(delta) {
    if (!this.entity) return;

    // Slow undulating rotation to convey living mass
    this.entity.rotation.x += Math.sin(performance.now() * 0.0003) * 0.0002;
    this.entity.rotation.z += Math.cos(performance.now() * 0.0002) * 0.00015;

    // Animate tendrils (children groups with multiple segments)
    this.entity.children.forEach((child) => {
      if (child.isGroup) {
        child.children.forEach((seg, idx) => {
          if (seg.isMesh) {
            seg.position.y += Math.sin(performance.now() * 0.001 + idx * 0.5) * 0.01;
            seg.position.z += Math.cos(performance.now() * 0.0008 + idx * 0.3) * 0.008;
          }
        });
      }
    });
  }

  _pulseBioluminescence(intensity) {
    if (!this._veinMat) return;
    const pulse = 1.5 + Math.sin(performance.now() * 0.002) * 1.0;
    // Update all vein meshes' emissive intensity
    this.entity.traverse((child) => {
      if (child.isMesh && child.material && child.material.emissive) {
        if (child.material.emissive.r < 0.1 && child.material.emissive.b > 0.1) {
          // Blue-ish emissive = bioluminescent vein
          child.material.emissiveIntensity = pulse * intensity;
        }
      }
    });

    // Pulse bioluminescent point lights
    for (const light of this.entityLights) {
      if (light.color.b > light.color.r) {
        // Blue lights = bio lights
        light.intensity = light.userData.baseIntensity * (0.5 + Math.sin(performance.now() * 0.003) * 0.5) * intensity;
      }
    }
  }

  _transition(newState) {
    this.state = newState;
    this.stateTime = 0;
  }

  getAudioState() {
    switch (this.state) {
      case State.TRIGGERED:
        return { state: this.state, intensity: 0.35 };
      case State.FOG_CLOSING:
        return {
          state: this.state,
          intensity: THREE.MathUtils.lerp(0.45, 0.82, Math.min(this.stateTime / FOG_CLOSE_DURATION, 1)),
        };
      case State.REVEAL:
        return { state: this.state, intensity: 1.0 };
      case State.DRIFT:
        return { state: this.state, intensity: 0.72 };
      case State.RETREAT:
        return {
          state: this.state,
          intensity: THREE.MathUtils.lerp(0.55, 0.12, Math.min(this.stateTime / RETREAT_DURATION, 1)),
        };
      default:
        return { state: this.state, intensity: 0 };
    }
  }
}
