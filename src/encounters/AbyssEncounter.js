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
 *
 * Instead of directly mutating fog/ambient, the encounter submits a named
 * modifier to the LightingPolicy which blends it on top of the depth-zone base.
 */
export class AbyssEncounter {
  constructor(options = {}) {
    this.state = State.IDLE;
    this.stateTime = 0;
    this.completed = false;
    this.entity = null;
    this.entityLights = [];
    this._pointLightBudget = options.pointLightBudget ?? null;
    this._pulseTargets = [];

    // Saved base-profile values captured at trigger time
    this._savedFogNear = 0;
    this._savedFogFar = 0;
    this._savedAmbientIntensity = 0;

    // Encounter fog targets (tightest point)
    this._closedFogNear = 1;
    this._closedFogFar = 60;

    // Reusable modifier object submitted to LightingPolicy
    this._modifier = { fogNear: 0, fogFar: 0, ambientIntensity: 0, weight: 0 };

    // Entity animation state
    this._entityStartPos = new THREE.Vector3();
    this._entityEndPos = new THREE.Vector3();
    this._entityDriftDir = new THREE.Vector3();
  }

  reset(scene, lightingPolicy) {
    this._despawnEntity(scene);
    if (lightingPolicy) lightingPolicy.removeModifier('abyss_encounter');
    this.state = State.IDLE;
    this.stateTime = 0;
    this.completed = false;
    this._savedFogNear = 0;
    this._savedFogFar = 0;
    this._savedAmbientIntensity = 0;
    this._modifier.weight = 0;
    this._entityStartPos.set(0, 0, 0);
    this._entityEndPos.set(0, 0, 0);
    this._entityDriftDir.set(0, 0, 0);
    this._pulseTargets = [];
  }

  update(delta, depth, player, scene, lightingPolicy, hud, audio) {
    if (this.completed) return;

    this.stateTime += delta;

    switch (this.state) {
      case State.IDLE:
        this._updateIdle(depth, player, scene, lightingPolicy, hud);
        break;
      case State.TRIGGERED:
        this._updateTriggered(delta, scene, lightingPolicy, hud, audio);
        break;
      case State.FOG_CLOSING:
        this._updateFogClosing(delta, lightingPolicy, hud, audio);
        break;
      case State.REVEAL:
        this._updateReveal(delta, lightingPolicy);
        break;
      case State.DRIFT:
        this._updateDrift(delta, lightingPolicy, audio);
        break;
      case State.RETREAT:
        this._updateRetreat(delta, scene, lightingPolicy);
        break;
    }

    // Animate entity if it exists
    if (this.entity) {
      this._animateEntity(delta);
    }
  }

  // --- State handlers ---

  _updateIdle(depth, player, scene, lightingPolicy, hud) {
    if (depth >= TRIGGER_DEPTH) {
      this._transition(State.TRIGGERED);
      // Capture base profile at trigger time
      const base = lightingPolicy.getBaseProfile();
      this._savedFogNear = base.fogNear;
      this._savedFogFar = base.fogFar;
      this._savedAmbientIntensity = base.ambient;

      // Spawn entity ahead and below the player
      this._spawnEntity(scene, player);
    }
  }

  _updateTriggered(delta, scene, lightingPolicy, hud, audio) {
    // Immediate transition to fog closing — brief pause for dramatic effect
    if (this.stateTime > 0.5) {
      hud._showWarning('MASSIVE ENTITY DETECTED', 4000);
      audio?.playEncounterDetected();
      this._transition(State.FOG_CLOSING);
    }
  }

  _updateFogClosing(delta, lightingPolicy, hud, audio) {
    const t = Math.min(this.stateTime / FOG_CLOSE_DURATION, 1);
    const ease = t * t; // ease-in

    // Tighten fog dramatically
    this._modifier.fogNear = THREE.MathUtils.lerp(this._savedFogNear, this._closedFogNear, ease);
    this._modifier.fogFar = THREE.MathUtils.lerp(this._savedFogFar, this._closedFogFar, ease);
    this._modifier.ambientIntensity = THREE.MathUtils.lerp(this._savedAmbientIntensity, 0.001, ease);
    this._modifier.weight = 1;
    lightingPolicy.setModifier('abyss_encounter', this._modifier);

    if (t >= 1) {
      audio?.playEncounterReveal();
      this._transition(State.REVEAL);
    }
  }

  _updateReveal(delta, lightingPolicy) {
    const t = Math.min(this.stateTime / REVEAL_DURATION, 1);
    const ease = t * t * (3 - 2 * t); // smoothstep

    // Gradually widen fog to reveal the entity's scale
    this._modifier.fogNear = THREE.MathUtils.lerp(this._closedFogNear, this._savedFogNear * 0.5, ease);
    this._modifier.fogFar = THREE.MathUtils.lerp(this._closedFogFar, this._savedFogFar * 0.8, ease);
    this._modifier.ambientIntensity = THREE.MathUtils.lerp(0.001, 0.008, ease);
    this._modifier.weight = 1;
    lightingPolicy.setModifier('abyss_encounter', this._modifier);

    // Pulse bioluminescence on the entity
    this._pulseBioluminescence(t);

    if (t >= 1) {
      this._transition(State.DRIFT);
    }
  }

  _updateDrift(delta, lightingPolicy, audio) {
    const t = Math.min(this.stateTime / DRIFT_DURATION, 1);
    const ease = t * t * (3 - 2 * t);

    // Entity drifts past — move along drift direction
    this.entity.position.lerpVectors(this._entityStartPos, this._entityEndPos, ease);

    // Slowly widen fog further during drift
    this._modifier.fogNear = THREE.MathUtils.lerp(this._savedFogNear * 0.5, this._savedFogNear * 0.7, ease);
    this._modifier.fogFar = THREE.MathUtils.lerp(this._savedFogFar * 0.8, this._savedFogFar * 0.9, ease);
    this._modifier.ambientIntensity = THREE.MathUtils.lerp(0.008, this._savedAmbientIntensity * 0.5, ease);
    this._modifier.weight = 1;
    lightingPolicy.setModifier('abyss_encounter', this._modifier);

    // Keep pulsing bioluminescence
    this._pulseBioluminescence(0.5 + t * 0.5);

    if (t >= 1) {
      audio?.playEncounterRetreat();
      this._transition(State.RETREAT);
    }
  }

  _updateRetreat(delta, scene, lightingPolicy) {
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

    // Dim entity lights — route through the budget system to avoid
    // intensity-fighting with the managed-light lerp.
    for (const light of this.entityLights) {
      const dimmed = light.userData.baseIntensity * (1 - ease);
      light.userData.duwBaseIntensity = dimmed;
      light.userData.duwTargetIntensity = dimmed;
    }

    // Blend modifier back toward current depth-zone base values
    const base = lightingPolicy.getBaseProfile();
    this._modifier.fogNear = THREE.MathUtils.lerp(this._savedFogNear * 0.7, base.fogNear, ease);
    this._modifier.fogFar = THREE.MathUtils.lerp(this._savedFogFar * 0.9, base.fogFar, ease);
    this._modifier.ambientIntensity = THREE.MathUtils.lerp(
      this._savedAmbientIntensity * 0.5, base.ambient, ease
    );
    this._modifier.weight = 1;
    lightingPolicy.setModifier('abyss_encounter', this._modifier);

    if (t >= 1) {
      // Clean up
      lightingPolicy.removeModifier('abyss_encounter');
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
    for (const light of this.entityLights) {
      this._pointLightBudget?.registerLight(light);
    }
  }

  _buildAbyssEntity() {
    const trackPulseMaterial = (material, pulseStrength = 1) => {
      this._pulseTargets.push({
        material,
        baseIntensity: material.emissiveIntensity ?? 0,
        pulseStrength,
      });
      return material;
    };

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

    // Eye material — deep red/orange glow
    const eyeMat = new THREE.MeshPhysicalMaterial({
      color: 0xff2200,
      emissive: 0xff3300,
      emissiveIntensity: 4.5,
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
      trackPulseMaterial(vein.material, 1.0);
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
        const eyeMaterial = eyeMat.clone();
        trackPulseMaterial(eyeMaterial, 0.35);
        const eye = new THREE.Mesh(eyeGeo, eyeMaterial);
        const xPos = -60 + i * 30 + (Math.random() - 0.5) * 10;
        eye.position.set(xPos, 10 + Math.random() * 5, side * (22 + Math.random() * 4));
        this.entity.add(eye);

        // Keep a sparse set of hero eye lights and let the rest read via emissive glow.
        if (i === 1 || i === 3) {
          const eyeLight = new THREE.PointLight(0xff3300, 3.4, 46);
          eyeLight.position.copy(eye.position);
          eyeLight.userData.baseIntensity = 3.4;
          eyeLight.userData.duwCategory = 'encounter_hero';
          this.entity.add(eyeLight);
          this.entityLights.push(eyeLight);
        }
      }
    }

    // --- Bioluminescent body glows with only a couple of shared hero lights ---
    const bioColors = [0x0044ff, 0x0066cc, 0x2244ff, 0x0088ff];
    for (let i = 0; i < 4; i++) {
      const glowPosition = new THREE.Vector3(
        -80 + i * 50,
        -5 + Math.random() * 10,
        (Math.random() - 0.5) * 30
      );
      const glowGeo = new THREE.SphereGeometry(4.5, 14, 10);
      glowGeo.scale(1.6, 0.7, 1.0);
      const glowMat = new THREE.MeshPhysicalMaterial({
        color: 0x081428,
        emissive: bioColors[i],
        emissiveIntensity: 2.8,
        transparent: true,
        opacity: 0.78,
        roughness: 0.08,
        metalness: 0.12,
      });
      trackPulseMaterial(glowMat, 1.0);
      const glowMesh = new THREE.Mesh(glowGeo, glowMat);
      glowMesh.position.copy(glowPosition);
      this.entity.add(glowMesh);

      if (i === 1 || i === 2) {
        const bioLight = new THREE.PointLight(bioColors[i], 5.6, 88);
        bioLight.position.copy(glowPosition);
        bioLight.userData.baseIntensity = 5.6;
        bioLight.userData.duwCategory = 'encounter_hero';
        bioLight.userData.duwPulseGroup = 'bio';
        this.entity.add(bioLight);
        this.entityLights.push(bioLight);
      }
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

    for (const light of this.entityLights) {
      this._pointLightBudget?.unregisterLight(light);
    }

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
    this._pulseTargets = [];
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
    const now = performance.now();
    const pulse = 1.5 + Math.sin(now * 0.002) * 1.0;
    for (const target of this._pulseTargets) {
      const pulseScale = THREE.MathUtils.lerp(1, pulse, target.pulseStrength);
      target.material.emissiveIntensity =
        target.baseIntensity * pulseScale * intensity;
    }

    // Pulse bioluminescent point lights — drive duwTargetIntensity so the
    // budget manager's per-frame lerp stays in sync with the pulse.
    for (const light of this.entityLights) {
      if (light.userData.duwPulseGroup !== 'bio') continue;
      const pulsed =
        light.userData.baseIntensity *
        (0.5 + Math.sin(now * 0.003) * 0.5) *
        intensity;
      light.userData.duwBaseIntensity = pulsed;
      light.userData.duwTargetIntensity = pulsed;
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
