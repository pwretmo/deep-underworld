import * as THREE from "three";
import { toStandardMaterial } from "./lodUtils.js";

const SIREN_LOD_NEAR_DISTANCE = 30;
const SIREN_LOD_MEDIUM_DISTANCE = 80;
const SIREN_RESPAWN_DISTANCE = 220;
const SIREN_RESPAWN_RADIUS = 96;
const SIREN_LOD_HYSTERESIS = 8;

const _tmpVecA = new THREE.Vector3();
const _tmpVecB = new THREE.Vector3();
const _tmpVecC = new THREE.Vector3();

const SIREN_TIER_PROFILE = {
  near: {
    skullSegs: [48, 32],
    eyeSegs: 18,
    jawTubularSegments: 44,
    jawRadialSegments: 10,
    toothSegments: 10,
    toothCount: 16,
    membraneCount: 3,
    membraneSegments: [24, 16],
    hornSegments: 10,
    hornCount: 9,
    ghostCount: 3,
    ghostSegments: 12,
    membraneCpuStep: 1,
  },
  medium: {
    skullSegs: [18, 14],
    eyeSegs: 12,
    jawTubularSegments: 22,
    jawRadialSegments: 7,
    toothSegments: 8,
    toothCount: 10,
    membraneCount: 2,
    membraneSegments: [12, 8],
    hornSegments: 8,
    hornCount: 6,
    ghostCount: 2,
    ghostSegments: 8,
    membraneCpuStep: 2,
  },
  far: {
    skullSegs: [2, 0],
    eyeSegs: 0,
    jawTubularSegments: 8,
    jawRadialSegments: 4,
    toothSegments: 0,
    toothCount: 0,
    membraneCount: 1,
    membraneSegments: [1, 1],
    hornSegments: 0,
    hornCount: 0,
    ghostCount: 0,
    ghostSegments: 0,
    membraneCpuStep: 4,
  },
};

function createBoneHeightTexture() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(size, size);
  const data = img.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = x / (size - 1);
      const ny = y / (size - 1);
      const ridge = Math.sin(nx * 28.0 + Math.cos(ny * 11.0) * 3.0) * 0.11;
      const pore = Math.sin(nx * 94.0 + ny * 57.0) * 0.045;
      const value = THREE.MathUtils.clamp(0.56 + ridge + pore, 0, 1);
      const i = (y * size + x) * 4;
      const c = Math.round(value * 255);
      data[i] = c;
      data[i + 1] = c;
      data[i + 2] = c;
      data[i + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2.4, 1.2);
  texture.needsUpdate = true;
  return texture;
}

function createMembraneNormalTexture() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(size, size);
  const data = img.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / (size - 1);
      const v = y / (size - 1);
      const flow = Math.sin(v * 82 + Math.cos(u * 21) * 2.8) * 0.2;
      const fibers = Math.cos(u * 65 + v * 16) * 0.17;
      const nx = THREE.MathUtils.clamp(0.5 + fibers, 0, 1);
      const ny = THREE.MathUtils.clamp(0.5 + flow, 0, 1);
      const nz =
        Math.sqrt(Math.max(0, 1 - (nx * 2 - 1) ** 2 - (ny * 2 - 1) ** 2)) *
          0.5 +
        0.5;
      const i = (y * size + x) * 4;
      data[i] = Math.round(nx * 255);
      data[i + 1] = Math.round(ny * 255);
      data[i + 2] = Math.round(nz * 255);
      data[i + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 5);
  texture.needsUpdate = true;
  return texture;
}

const boneHeightTexture = createBoneHeightTexture();
const membraneNormalTexture = createMembraneNormalTexture();

// Floating elongated skull with trailing biomechanical membrane tendrils - siren of the deep
export class SirenSkull {
  constructor(scene, position) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.time = Math.random() * 100;
    this.speed = 1.25 + Math.random() * 0.85;
    this.direction = new THREE.Vector3(
      Math.random() - 0.5,
      -0.08,
      Math.random() - 0.5,
    ).normalize();
    this.desiredDirection = this.direction.clone();
    this.velocity = new THREE.Vector3();
    this.turnTimer = 0;
    this.turnInterval = 9 + Math.random() * 12;
    this.bobPhase = Math.random() * Math.PI * 2;
    this.listeningTilt = (Math.random() - 0.5) * 0.12;
    this.listeningTimer = 0;
    this.listeningInterval = 3 + Math.random() * 4;
    this.songPhase = Math.random() * Math.PI * 2;
    this.membranePhase = Math.random() * Math.PI * 2;
    this.ghostPhase = Math.random() * Math.PI * 2;
    this._frameCount = 0;
    this._lastLodTier = "near";

    this._buildModel();
    this.group.position.copy(position);
    scene.add(this.group);
  }

  _buildModel() {
    this.tiers = {};
    this.lod = new THREE.LOD();

    for (const [tierName, profile] of Object.entries(SIREN_TIER_PROFILE)) {
      const tier = this._buildTier(profile, tierName);
      this.tiers[tierName] = tier;
      const dist =
        tierName === "near"
          ? 0
          : tierName === "medium"
            ? SIREN_LOD_NEAR_DISTANCE
            : SIREN_LOD_MEDIUM_DISTANCE;
      this.lod.addLevel(tier.group, dist);
    }

    this.group.add(this.lod);
    this.jawMesh = this.tiers.near.lowerJaw;
    this._baseScale = 0.85 + Math.random() * 1.4;
    this.group.scale.setScalar(this._baseScale);
  }

  _createBoneMaterial(useFarMat, detailScale = 1) {
    let material = new THREE.MeshPhysicalMaterial({
      color: 0x3a3228,
      roughness: 0.28,
      metalness: 0.06,
      clearcoat: 0.85,
      clearcoatRoughness: 0.18,
      emissive: 0x2a2218,
      emissiveIntensity: 0.45,
      displacementMap: boneHeightTexture,
      displacementScale: 0.03 * detailScale,
      displacementBias: -0.012,
      normalMap: membraneNormalTexture,
      normalScale: new THREE.Vector2(0.22 * detailScale, 0.14 * detailScale),
      envMapIntensity: 0.55,
    });
    if (useFarMat) material = toStandardMaterial(material);
    return material;
  }

  _createMembraneMaterial(useFarMat, opacity = 0.43) {
    let material = new THREE.MeshPhysicalMaterial({
      color: 0x261824,
      emissive: 0x4e3048,
      emissiveIntensity: 0.55,
      roughness: 0.21,
      metalness: 0.02,
      transmission: useFarMat ? 0 : 0.48,
      thickness: useFarMat ? 0 : 0.22,
      transparent: true,
      opacity,
      depthWrite: false,
      side: THREE.DoubleSide,
      normalMap: membraneNormalTexture,
      normalScale: new THREE.Vector2(0.35, 0.22),
    });
    if (useFarMat) {
      material = toStandardMaterial(material);
      material.depthWrite = false;
    }

    material.userData.shaderUniforms = {
      uFlutterTime: { value: 0 },
      uVelocity: { value: new THREE.Vector3() },
      uPulse: { value: 0 },
    };

    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, material.userData.shaderUniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
uniform float uFlutterTime;
uniform vec3 uVelocity;
varying float vEdgeFlicker;`,
        )
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
float trail = 1.0 - uv.y;
float edge = abs(uv.x * 2.0 - 1.0);
float velocityMag = length(uVelocity);
float wave = sin((position.y + uFlutterTime * 2.4) * 5.2 + uv.x * 10.5) * trail * (0.06 + velocityMag * 0.018);
float flutter = sin(uFlutterTime * 11.0 + uv.y * 20.0 + uv.x * 13.0) * edge * trail * 0.02;
transformed.z += wave + flutter;
transformed.x += uVelocity.x * trail * 0.08;
transformed.y -= abs(uVelocity.y) * trail * 0.04;
vEdgeFlicker = edge * trail;`,
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
uniform float uPulse;
varying float vEdgeFlicker;`,
        )
        .replace(
          "#include <emissivemap_fragment>",
          `#include <emissivemap_fragment>
totalEmissiveRadiance += vec3(0.22, 0.08, 0.12) * vEdgeFlicker * (0.5 + uPulse * 0.5);`,
        );
    };

    return material;
  }

  _buildTier(profile, tierName) {
    const tierGroup = new THREE.Group();
    const useFarMat = tierName === "far";
    const detailScale =
      tierName === "near" ? 1 : tierName === "medium" ? 0.65 : 0.2;

    const boneMaterial = this._createBoneMaterial(useFarMat, detailScale);
    const sutureMaterial = useFarMat
      ? new THREE.MeshStandardMaterial({
          color: 0x262018,
          emissive: 0x140e0c,
          emissiveIntensity: 0.15,
        })
      : new THREE.MeshPhysicalMaterial({
          color: 0x2a241d,
          roughness: 0.82,
          metalness: 0.05,
          emissive: 0x120c0a,
          emissiveIntensity: 0.2,
        });
    const socketMaterial = useFarMat
      ? new THREE.MeshStandardMaterial({
          color: 0x09090a,
          emissive: 0x200b12,
          emissiveIntensity: 0.35,
        })
      : new THREE.MeshPhysicalMaterial({
          color: 0x08080a,
          emissive: 0x341018,
          emissiveIntensity: 0.6,
          roughness: 1.0,
          metalness: 0.0,
        });
    const eyeMaterial = useFarMat
      ? new THREE.MeshStandardMaterial({
          color: 0x93253f,
          emissive: 0x8c1d34,
          emissiveIntensity: 1.0,
        })
      : new THREE.MeshPhysicalMaterial({
          color: 0xc42a4a,
          emissive: 0xb4203d,
          emissiveIntensity: 1.6,
          roughness: 0.06,
          metalness: 0.0,
          transmission: 0.35,
          thickness: 0.2,
        });
    const membraneMaterial = this._createMembraneMaterial(
      useFarMat,
      tierName === "near" ? 0.44 : tierName === "medium" ? 0.36 : 0.22,
    );
    const hornMaterial = useFarMat
      ? new THREE.MeshStandardMaterial({
          color: 0x413229,
          emissive: 0x130f0b,
          emissiveIntensity: 0.12,
        })
      : new THREE.MeshPhysicalMaterial({
          color: 0x4e3f32,
          roughness: 0.34,
          metalness: 0.1,
          emissive: 0x1c140f,
          emissiveIntensity: 0.22,
        });
    const ghostMaterial = useFarMat
      ? new THREE.MeshStandardMaterial({
          color: 0x7ef8ff,
          emissive: 0x49d7ec,
          emissiveIntensity: 0.8,
          transparent: true,
          opacity: 0.8,
        })
      : new THREE.MeshPhysicalMaterial({
          color: 0x8ff4ff,
          emissive: 0x53dbf0,
          emissiveIntensity: 1.8,
          roughness: 0.05,
          metalness: 0.0,
          transmission: 0.8,
          thickness: 0.15,
          transparent: true,
          opacity: 0.88,
        });

    const skull =
      profile.skullSegs[1] === 0
        ? new THREE.Mesh(
            new THREE.OctahedronGeometry(0.78, profile.skullSegs[0]),
            boneMaterial,
          )
        : new THREE.Mesh(
            new THREE.SphereGeometry(
              0.5,
              profile.skullSegs[0],
              profile.skullSegs[1],
            ),
            boneMaterial,
          );

    skull.geometry.scale(2.0, 1.08, 0.95);
    this._deformSkull(skull.geometry, tierName !== "far");
    tierGroup.add(skull);

    const sutureMeshes = [];
    if (tierName !== "far") {
      for (let i = 0; i < 3; i++) {
        const points = [];
        const zBias = (i - 1) * 0.16;
        for (let s = 0; s <= 10; s++) {
          const t = s / 10;
          points.push(
            new THREE.Vector3(
              -0.55 + t * 1.3,
              0.2 + Math.sin(t * Math.PI * 1.7 + i * 0.8) * 0.06,
              zBias + Math.sin(t * 5 + i) * 0.03,
            ),
          );
        }
        const curve = new THREE.CatmullRomCurve3(
          points,
          false,
          "catmullrom",
          0.6,
        );
        const geo = new THREE.TubeGeometry(curve, 24, 0.012, 6, false);
        const mesh = new THREE.Mesh(geo, sutureMaterial);
        mesh.position.x = 0.05;
        tierGroup.add(mesh);
        sutureMeshes.push(mesh);
      }
    }

    const socketMeshes = [];
    const eyeRemnants = [];
    if (profile.eyeSegs > 0) {
      for (const side of [-1, 1]) {
        const socket = new THREE.Mesh(
          new THREE.SphereGeometry(0.18, profile.eyeSegs, profile.eyeSegs),
          socketMaterial,
        );
        socket.scale.set(1.0, 0.9, 1.1);
        socket.position.set(0.86, 0.12, side * 0.42);
        tierGroup.add(socket);
        socketMeshes.push(socket);

        const remnantEye = new THREE.Mesh(
          new THREE.SphereGeometry(
            0.068,
            Math.max(6, profile.eyeSegs - 4),
            Math.max(6, profile.eyeSegs - 4),
          ),
          eyeMaterial,
        );
        remnantEye.position.set(0.92, 0.11, side * 0.42);
        tierGroup.add(remnantEye);
        eyeRemnants.push(remnantEye);
      }

      for (const side of [-1, 1]) {
        const nasalCavity = new THREE.Mesh(
          new THREE.ConeGeometry(0.06, 0.2, 8),
          socketMaterial,
        );
        nasalCavity.position.set(0.72, -0.02, side * 0.08);
        nasalCavity.rotation.z = side * 0.12;
        nasalCavity.rotation.x = Math.PI * 0.56;
        tierGroup.add(nasalCavity);
      }
    }

    let jawRoot = null;
    let upperJaw = null;
    let lowerJaw = null;
    if (tierName !== "far") {
      jawRoot = new THREE.Group();
      jawRoot.position.set(0.28, -0.23, 0);
      tierGroup.add(jawRoot);

      upperJaw = this._buildMandible(
        profile,
        false,
        boneMaterial,
        sutureMaterial,
        tierName,
      );
      lowerJaw = this._buildMandible(
        profile,
        true,
        boneMaterial,
        sutureMaterial,
        tierName,
      );
      upperJaw.position.y = 0.02;
      lowerJaw.position.y = -0.03;
      jawRoot.add(upperJaw);
      jawRoot.add(lowerJaw);
    }

    const membranes = [];
    for (let i = 0; i < profile.membraneCount; i++) {
      const width = 1.5 - i * 0.2;
      const height = 0.8 + i * 0.4;
      const membraneGeo = new THREE.PlaneGeometry(
        width,
        height,
        profile.membraneSegments[0],
        profile.membraneSegments[1],
      );
      const positionAttr = membraneGeo.attributes.position;
      const uvAttr = membraneGeo.attributes.uv;
      const base = new Float32Array(positionAttr.array.length);
      base.set(positionAttr.array);
      for (let v = 0; v < positionAttr.count; v++) {
        const y = positionAttr.getY(v);
        const uvx = uvAttr.getX(v);
        const edge = Math.abs(uvx * 2 - 1);
        positionAttr.setZ(v, Math.sin(y * 3.2 + i * 0.9) * 0.055 + edge * 0.01);
      }
      membraneGeo.computeVertexNormals();

      const membraneMesh = new THREE.Mesh(membraneGeo, membraneMaterial);
      membraneMesh.position.set(
        -1.36 - i * 0.22,
        -0.18 - i * 0.19,
        (i - 1) * 0.42,
      );
      membraneMesh.rotation.set(
        0.18 + i * 0.06,
        -0.1 - i * 0.06,
        (i - 1) * 0.14,
      );
      membraneMesh.userData.memData = {
        base,
        originalX: membraneMesh.position.x,
        phase: this.membranePhase + i * 1.7,
      };

      tierGroup.add(membraneMesh);
      membranes.push(membraneMesh);
    }

    const hornRoot = new THREE.Group();
    hornRoot.position.set(-1.08, 0.1, 0);
    tierGroup.add(hornRoot);
    const horns = [];
    if (profile.hornCount > 0) {
      for (let i = 0; i < profile.hornCount; i++) {
        const t = i / Math.max(1, profile.hornCount - 1);
        const angle = -0.65 + t * 1.3;
        const height = 0.3 + Math.sin(t * Math.PI) * 0.36;
        const horn = new THREE.Mesh(
          new THREE.ConeGeometry(0.03, height, profile.hornSegments),
          hornMaterial,
        );
        horn.position.set(
          0,
          -0.06 + Math.sin(t * Math.PI) * 0.22,
          (t - 0.5) * 1.3,
        );
        horn.rotation.z = angle;
        horn.userData.baseRotation = angle;
        horn.userData.baseScaleY = 1;
        hornRoot.add(horn);
        horns.push(horn);
      }
    }

    const ghostLights = [];
    for (let i = 0; i < profile.ghostCount; i++) {
      const light = new THREE.Mesh(
        new THREE.SphereGeometry(
          0.03,
          profile.ghostSegments,
          profile.ghostSegments,
        ),
        ghostMaterial.clone(),
      );
      light.position.set(0.88, 0.24 - i * 0.1, (i - 1) * 0.26);
      light.userData.orbitRadius = 0.38 + i * 0.14;
      light.userData.orbitSpeed = 0.7 + i * 0.35 + Math.random() * 0.22;
      light.userData.orbitHeight = -0.18 + i * 0.15;
      light.userData.phase = this.ghostPhase + i * (Math.PI * 0.66);
      tierGroup.add(light);
      ghostLights.push(light);
    }

    return {
      group: tierGroup,
      profile,
      skull,
      sutureMeshes,
      socketMeshes,
      eyeRemnants,
      jawRoot,
      upperJaw,
      lowerJaw,
      membranes,
      hornRoot,
      horns,
      ghostLights,
      membraneMaterial,
      eyeMaterial,
    };
  }

  _buildMandible(profile, isLower, boneMaterial, toothRootMaterial, tierName) {
    const group = new THREE.Group();
    const jawSign = isLower ? -1 : 1;
    const curvePoints = [
      new THREE.Vector3(-0.1, -0.03 * jawSign, 0.52),
      new THREE.Vector3(0.2, -0.08 * jawSign, 0.4),
      new THREE.Vector3(0.48, -0.16 * jawSign, 0.16),
      new THREE.Vector3(0.56, -0.2 * jawSign, 0.0),
    ];
    const halfCurve = new THREE.CatmullRomCurve3(
      curvePoints,
      false,
      "catmullrom",
      0.5,
    );
    const leftHalf = new THREE.Mesh(
      new THREE.TubeGeometry(
        halfCurve,
        profile.jawTubularSegments,
        0.05,
        profile.jawRadialSegments,
        false,
      ),
      boneMaterial,
    );
    leftHalf.rotation.y = Math.PI;
    leftHalf.position.z = 0.53;
    group.add(leftHalf);

    const rightHalf = new THREE.Mesh(
      new THREE.TubeGeometry(
        halfCurve,
        profile.jawTubularSegments,
        0.05,
        profile.jawRadialSegments,
        false,
      ),
      boneMaterial,
    );
    rightHalf.position.z = -0.53;
    group.add(rightHalf);

    const frontBridge = new THREE.Mesh(
      new THREE.TorusGeometry(
        0.53,
        0.045,
        profile.jawRadialSegments,
        profile.jawTubularSegments,
        Math.PI,
      ),
      boneMaterial,
    );
    frontBridge.rotation.y = Math.PI / 2;
    frontBridge.position.set(0.54, -0.2 * jawSign, 0);
    group.add(frontBridge);

    const rearFlareL = new THREE.Mesh(
      new THREE.SphereGeometry(
        0.11,
        Math.max(8, profile.jawRadialSegments + 3),
        Math.max(7, profile.jawRadialSegments + 2),
      ),
      boneMaterial,
    );
    rearFlareL.position.set(-0.06, -0.02 * jawSign, 0.51);
    group.add(rearFlareL);

    const rearFlareR = rearFlareL.clone();
    rearFlareR.position.z *= -1;
    group.add(rearFlareR);

    if (profile.toothCount > 0) {
      const toothRootGeo = new THREE.CylinderGeometry(0.012, 0.016, 0.048, 8);
      const toothGeo = new THREE.ConeGeometry(
        0.022,
        0.13,
        profile.toothSegments,
      );
      for (let i = 0; i < profile.toothCount; i++) {
        const t = i / Math.max(1, profile.toothCount - 1);
        const arc = -Math.PI * 0.36 + t * Math.PI * 0.72;
        const r = 0.51;
        const baseX = 0.55 + Math.cos(arc) * 0.16;
        const baseZ = Math.sin(arc) * r;

        const root = new THREE.Mesh(toothRootGeo, toothRootMaterial);
        root.position.set(baseX, -0.2 * jawSign, baseZ);
        root.rotation.x = Math.PI / 2;
        group.add(root);

        const tooth = new THREE.Mesh(toothGeo, toothRootMaterial);
        tooth.position.set(
          baseX + (isLower ? -0.005 : 0.005),
          -0.2 * jawSign + (isLower ? -0.06 : 0.06),
          baseZ,
        );
        tooth.rotation.z = isLower ? Math.PI : 0;
        tooth.rotation.x = (isLower ? -1 : 1) * (0.15 + Math.abs(baseZ) * 0.35);
        group.add(tooth);
      }
    }

    if (tierName === "far") {
      group.scale.set(1, 0.8, 0.75);
    }

    return group;
  }

  _deformSkull(geometry, includeMicroDetails) {
    const p = geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      const z = p.getZ(i);

      const brow = y > 0.38 && x > 0.4 ? 0.1 : 0;
      const cheek = y < 0.03 && Math.abs(z) > 0.3 ? -0.08 : 0;
      const nasal = x > 0.5 && Math.abs(z) < 0.12 ? -0.05 : 0;
      const cranium = x < -0.25 ? 0.04 : 0;
      const micro = includeMicroDetails
        ? Math.sin(y * 16 + z * 11 + x * 9) * 0.014
        : 0;

      p.setY(i, y + brow + cheek + micro * 0.5);
      p.setX(i, x + cranium + micro);
      p.setZ(i, z + nasal * Math.sign(z || 1) * 0.8);
    }
    geometry.computeVertexNormals();
  }

  update(dt, playerPos) {
    this.time += dt;
    this._frameCount++;
    this.turnTimer += dt;
    this.listeningTimer += dt;

    const distToPlayer = this.group.position.distanceTo(playerPos);
    const proximity = THREE.MathUtils.clamp(1 - distToPlayer / 55, 0, 1);
    const songPulse = 0.5 + Math.sin(this.time * 2.8 + this.songPhase) * 0.5;

    if (this.listeningTimer >= this.listeningInterval) {
      this.listeningTimer = 0;
      this.listeningInterval = 2.5 + Math.random() * 4;
      this.listeningTilt = (Math.random() - 0.5) * 0.22;
    }

    if (this.turnTimer > this.turnInterval) {
      this.turnTimer = 0;
      this.turnInterval = 9 + Math.random() * 12;
      if (Math.random() < 0.6) {
        this.desiredDirection
          .subVectors(playerPos, this.group.position)
          .normalize();
        this.desiredDirection.y *= 0.35;
      } else {
        this.desiredDirection
          .set(
            Math.random() - 0.5,
            (Math.random() - 0.5) * 0.09,
            Math.random() - 0.5,
          )
          .normalize();
      }
    }

    this.direction.lerp(this.desiredDirection, dt * 0.45);
    _tmpVecA
      .copy(this.direction)
      .multiplyScalar(this.speed * (0.7 + proximity * 0.35));
    this.velocity.lerp(_tmpVecA, dt * 1.8);
    this.group.position.addScaledVector(this.velocity, dt);
    this.group.position.y +=
      Math.sin(this.time * 0.65 + this.bobPhase) * 0.26 * dt;

    const targetYaw =
      Math.atan2(this.direction.x, this.direction.z) + Math.PI / 2;
    this.group.rotation.y = THREE.MathUtils.lerp(
      this.group.rotation.y,
      targetYaw,
      dt * 1.2,
    );

    _tmpVecB.subVectors(playerPos, this.group.position).normalize();
    const targetTilt = this.listeningTilt + _tmpVecB.y * 0.28;
    this.group.rotation.z = THREE.MathUtils.lerp(
      this.group.rotation.z,
      targetTilt * (0.3 + proximity * 0.9),
      dt * 0.65,
    );
    this.group.rotation.x = THREE.MathUtils.lerp(
      this.group.rotation.x,
      Math.sin(this.time * 0.4 + this.bobPhase) * 0.05 + proximity * 0.11,
      dt * 0.9,
    );

    const lodTier = this._selectLodTier(distToPlayer);
    const shouldUpdateFar = lodTier !== "far" || this._frameCount % 4 === 0;
    if (shouldUpdateFar) {
      this._updateTierAnimation(
        this.tiers[lodTier],
        lodTier,
        dt,
        proximity,
        songPulse,
      );
    }

    const pulseScale =
      1 +
      (0.015 + proximity * 0.02) * Math.sin(this.time * 1.4 + this.songPhase);
    this.group.scale.setScalar(this._baseScale * pulseScale);

    if (distToPlayer > SIREN_RESPAWN_DISTANCE) {
      const a = Math.random() * Math.PI * 2;
      this.group.position.set(
        playerPos.x + Math.cos(a) * SIREN_RESPAWN_RADIUS,
        playerPos.y - Math.random() * 18,
        playerPos.z + Math.sin(a) * SIREN_RESPAWN_RADIUS,
      );
    }
  }

  _selectLodTier(distanceToPlayer) {
    const prev = this._lastLodTier;
    if (
      prev === "near" &&
      distanceToPlayer < SIREN_LOD_NEAR_DISTANCE + SIREN_LOD_HYSTERESIS
    )
      return prev;
    if (
      prev === "medium" &&
      distanceToPlayer > SIREN_LOD_NEAR_DISTANCE - SIREN_LOD_HYSTERESIS &&
      distanceToPlayer < SIREN_LOD_MEDIUM_DISTANCE + SIREN_LOD_HYSTERESIS
    )
      return prev;
    if (
      prev === "far" &&
      distanceToPlayer > SIREN_LOD_MEDIUM_DISTANCE - SIREN_LOD_HYSTERESIS
    )
      return prev;

    this._lastLodTier =
      distanceToPlayer < SIREN_LOD_NEAR_DISTANCE
        ? "near"
        : distanceToPlayer < SIREN_LOD_MEDIUM_DISTANCE
          ? "medium"
          : "far";
    return this._lastLodTier;
  }

  _updateTierAnimation(tier, tierName, dt, proximity, songPulse) {
    if (!tier) return;

    if (tier.upperJaw && tier.lowerJaw) {
      const jawBaseOpen = -0.2 - songPulse * 0.32 - proximity * 0.2;
      const jawRhythm = Math.sin(this.time * 3.1 + this.songPhase) * 0.08;
      tier.lowerJaw.rotation.z = THREE.MathUtils.lerp(
        tier.lowerJaw.rotation.z,
        jawBaseOpen + jawRhythm,
        dt * 2.5,
      );
      tier.upperJaw.rotation.z = THREE.MathUtils.lerp(
        tier.upperJaw.rotation.z,
        0.06 + Math.sin(this.time * 1.6 + 0.5) * 0.03 - proximity * 0.05,
        dt * 2.2,
      );
    }

    const threatSplay = 1 + proximity * 0.6;
    for (let i = 0; i < tier.horns.length; i++) {
      const horn = tier.horns[i];
      const pulse = Math.sin(this.time * 1.5 + i * 0.6) * 0.04;
      horn.rotation.z = horn.userData.baseRotation * threatSplay + pulse;
      horn.scale.y = THREE.MathUtils.lerp(
        horn.scale.y,
        horn.userData.baseScaleY + proximity * 0.55,
        dt * 1.4,
      );
    }

    for (let i = 0; i < tier.ghostLights.length; i++) {
      const ghost = tier.ghostLights[i];
      if (tierName === "near") {
        const drift =
          this.time * ghost.userData.orbitSpeed + ghost.userData.phase;
        const radius = ghost.userData.orbitRadius * (1 - proximity * 0.55);
        ghost.position.set(
          0.74 + Math.cos(drift) * radius,
          0.17 + ghost.userData.orbitHeight + Math.sin(drift * 1.6) * 0.09,
          Math.sin(drift * 0.85) * radius,
        );
      }
      ghost.rotation.y += dt * (0.6 + i * 0.2);
      const mat = ghost.material;
      mat.emissiveIntensity =
        tierName === "near"
          ? 1.2 + songPulse * 1.2 + proximity * 0.7
          : 0.8 + songPulse * 0.7;
    }

    for (let i = 0; i < tier.eyeRemnants.length; i++) {
      const eye = tier.eyeRemnants[i];
      const flicker =
        0.7 + Math.sin(this.time * (5.5 + i * 2.1)) * 0.28 + songPulse * 0.32;
      eye.material.emissiveIntensity = flicker;
      eye.scale.setScalar(0.95 + songPulse * 0.12);
    }

    if (tierName !== "far") {
      tier.membraneMaterial.userData.shaderUniforms.uFlutterTime.value =
        this.time;
      tier.membraneMaterial.userData.shaderUniforms.uVelocity.value.copy(
        this.velocity,
      );
      tier.membraneMaterial.userData.shaderUniforms.uPulse.value = songPulse;
    }

    if (tierName !== "far") {
      this._updateMembranesCpu(
        tier,
        dt,
        tier.profile.membraneCpuStep,
        proximity,
      );
    }
  }

  _updateMembranesCpu(tier, dt, cpuStep, proximity) {
    for (let i = 0; i < tier.membranes.length; i++) {
      const membrane = tier.membranes[i];
      const geometry = membrane.geometry;
      const position = geometry.attributes.position;
      const uv = geometry.attributes.uv;
      const base = membrane.userData.memData.base;
      const posArray = position.array;
      const uvArray = uv.array;
      const phase = membrane.userData.memData.phase;

      const velocityStretchX = this.velocity.x * (0.08 + proximity * 0.04);
      const velocityStretchY =
        Math.abs(this.velocity.y) * (0.06 + proximity * 0.04);

      for (let v = 0; v < position.count; v += cpuStep) {
        const pIndex = v * 3;
        const uvIndex = v * 2;
        const u = uvArray[uvIndex];
        const vv = uvArray[uvIndex + 1];
        const trail = 1 - vv;
        const edge = Math.abs(u * 2 - 1);

        const propagation =
          Math.sin(this.time * (2.4 + i * 0.35) + trail * 8.5 + phase) * trail;
        const drag = Math.sin(this.time * 6.8 + u * 14.0 + i) * edge * trail;

        posArray[pIndex] = base[pIndex] + velocityStretchX * trail * 0.9;
        posArray[pIndex + 1] =
          base[pIndex + 1] - velocityStretchY * trail * 0.3;
        posArray[pIndex + 2] =
          base[pIndex + 2] +
          propagation * (0.09 + proximity * 0.05) +
          drag * 0.04;
      }

      position.needsUpdate = true;
      geometry.computeVertexNormals();

      membrane.position.x =
        membrane.userData.memData.originalX -
        this.velocity.length() * (0.06 + i * 0.01);
    }
  }

  getPosition() {
    return this.group.position;
  }
  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((c) => {
      if (c.geometry) c.geometry.dispose();
      if (c.material) {
        if (Array.isArray(c.material)) {
          c.material.forEach((m) => m.dispose());
        } else {
          c.material.dispose();
        }
      }
    });
  }
}
