import { performance } from "node:perf_hooks";

import { CatmullRomCurve3, PlaneGeometry, TubeGeometry, Vector3 } from "three";

import { createFloraPayload } from "../src/environment/chunkPayloadWorker.js";

const CHUNK_RADIUS = 2;
const CHUNK_SIZE = 80;
const FLORA_DENSITY_SCALE = 1.0;
const REPRESENTATIVE_SCENE_SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

const DT = 1 / 60;
const LEGACY_WARMUP_FRAMES = 240;
const LEGACY_MEASURE_FRAMES = 2400;
const CURRENT_WARMUP_FRAMES = 10_000;
const CURRENT_MEASURE_FRAME_COUNTS = [200_000, 1_000_000, 5_000_000];

const KELP_SWAY_FREQUENCY = 0.5;
const KELP_SWAY_DELTA = 0.3;

const WATER_SURFACE_X_WAVE_SCALE = 0.05;
const WATER_SURFACE_X_WAVE_SPEED = 0.5;
const WATER_SURFACE_X_WAVE_AMPLITUDE = 0.5;
const WATER_SURFACE_Z_WAVE_SCALE = 0.03;
const WATER_SURFACE_Z_WAVE_SPEED = 0.3;
const WATER_SURFACE_Z_WAVE_AMPLITUDE = 0.3;

const WATER_SURFACE_WIDTH = 2000;
const WATER_SURFACE_HEIGHT = 2000;
const WATER_SURFACE_SEGMENTS = 100;

function createMulberry32(seed) {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function withSeededRandom(seed, callback) {
  const originalRandom = Math.random;
  Math.random = createMulberry32(seed);

  try {
    return callback();
  } finally {
    Math.random = originalRandom;
  }
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatMs(value) {
  if (value >= 0.1) return `${value.toFixed(3)} ms`;
  if (value >= 0.001) return `${value.toFixed(4)} ms`;
  return `${value.toExponential(3)} ms`;
}

function formatPercent(value) {
  return `${value.toFixed(2)}%`;
}

function createRepresentativeScene(seed) {
  const kelps = [];

  withSeededRandom(seed, () => {
    for (let cx = -CHUNK_RADIUS; cx <= CHUNK_RADIUS; cx++) {
      for (let cz = -CHUNK_RADIUS; cz <= CHUNK_RADIUS; cz++) {
        const payload = createFloraPayload({
          cx,
          cz,
          chunkSize: CHUNK_SIZE,
          floraDensityScale: FLORA_DENSITY_SCALE,
        });

        for (const kelp of payload.kelps) {
          const segHeight = kelp.height / kelp.segments;
          const points = [];

          for (let index = 0; index <= kelp.segments; index++) {
            points.push(new Vector3(0, index * segHeight, 0));
          }

          const curve = new CatmullRomCurve3(points);
          const geometry = new TubeGeometry(
            curve,
            kelp.segments,
            kelp.radius,
            4,
            false,
          );
          const basePositions = new Float32Array(
            geometry.attributes.position.array,
          );

          kelps.push({
            basePositions,
            phase: kelp.phase,
            segments: kelp.segments,
            segHeight,
            vertexCount: geometry.attributes.position.count,
          });

          geometry.dispose();
        }
      }
    }
  });

  const waterGeometry = new PlaneGeometry(
    WATER_SURFACE_WIDTH,
    WATER_SURFACE_HEIGHT,
    WATER_SURFACE_SEGMENTS,
    WATER_SURFACE_SEGMENTS,
  );
  const waterBasePositions = new Float32Array(
    waterGeometry.attributes.position.array,
  );
  const waterVertexCount = waterGeometry.attributes.position.count;
  waterGeometry.dispose();

  return {
    seed,
    kelps,
    kelpCount: kelps.length,
    kelpVertexCount: kelps.reduce((sum, kelp) => sum + kelp.vertexCount, 0),
    waterBasePositions,
    waterVertexCount,
  };
}

function createLegacyKelpState(scene) {
  return {
    time: 0,
    kelps: scene.kelps.map((kelp) => ({
      positions: new Float32Array(kelp.basePositions),
      phase: kelp.phase,
      segments: kelp.segments,
      segHeight: kelp.segHeight,
    })),
  };
}

function createLegacyWaterState(scene) {
  return {
    time: 0,
    waterBasePositions: scene.waterBasePositions,
    waterPositions: new Float32Array(scene.waterBasePositions),
  };
}

function createLegacyCombinedState(scene) {
  return {
    time: 0,
    kelps: scene.kelps.map((kelp) => ({
      positions: new Float32Array(kelp.basePositions),
      phase: kelp.phase,
      segments: kelp.segments,
      segHeight: kelp.segHeight,
    })),
    waterBasePositions: scene.waterBasePositions,
    waterPositions: new Float32Array(scene.waterBasePositions),
  };
}

function createCurrentState() {
  return {
    time: 0,
    kelpTimeUniform: { value: 0 },
    waterTimeUniform: { value: 0 },
  };
}

function stepLegacyKelp(state) {
  state.time += DT;

  for (const kelp of state.kelps) {
    const sway =
      Math.sin(state.time * KELP_SWAY_FREQUENCY + kelp.phase) * KELP_SWAY_DELTA;
    const positions = kelp.positions;
    const kelpHeight = kelp.segments * kelp.segHeight;

    for (let index = 0; index < positions.length; index += 3) {
      const heightRatio = positions[index + 1] / kelpHeight;
      positions[index] += sway * heightRatio * DT;
    }
  }
}

function stepLegacyWater(state) {
  state.time += DT;

  const base = state.waterBasePositions;
  const positions = state.waterPositions;

  for (let index = 0; index < positions.length; index += 3) {
    const x = base[index];
    const z = base[index + 1];
    const baseY = base[index + 2];

    positions[index + 2] =
      baseY +
      Math.sin(
        x * WATER_SURFACE_X_WAVE_SCALE +
          state.time * WATER_SURFACE_X_WAVE_SPEED,
      ) *
        WATER_SURFACE_X_WAVE_AMPLITUDE +
      Math.cos(
        z * WATER_SURFACE_Z_WAVE_SCALE +
          state.time * WATER_SURFACE_Z_WAVE_SPEED,
      ) *
        WATER_SURFACE_Z_WAVE_AMPLITUDE;
  }
}

function stepLegacyCombined(state) {
  state.time += DT;

  for (const kelp of state.kelps) {
    const sway =
      Math.sin(state.time * KELP_SWAY_FREQUENCY + kelp.phase) * KELP_SWAY_DELTA;
    const positions = kelp.positions;
    const kelpHeight = kelp.segments * kelp.segHeight;

    for (let index = 0; index < positions.length; index += 3) {
      const heightRatio = positions[index + 1] / kelpHeight;
      positions[index] += sway * heightRatio * DT;
    }
  }

  const base = state.waterBasePositions;
  const positions = state.waterPositions;

  for (let index = 0; index < positions.length; index += 3) {
    const x = base[index];
    const z = base[index + 1];
    const baseY = base[index + 2];

    positions[index + 2] =
      baseY +
      Math.sin(
        x * WATER_SURFACE_X_WAVE_SCALE +
          state.time * WATER_SURFACE_X_WAVE_SPEED,
      ) *
        WATER_SURFACE_X_WAVE_AMPLITUDE +
      Math.cos(
        z * WATER_SURFACE_Z_WAVE_SCALE +
          state.time * WATER_SURFACE_Z_WAVE_SPEED,
      ) *
        WATER_SURFACE_Z_WAVE_AMPLITUDE;
  }
}

function stepCurrentCombined(state) {
  state.time += DT;
  state.kelpTimeUniform.value = state.time;
  state.waterTimeUniform.value = state.time;
}

function runFrames(frameCount, step, state) {
  for (let frame = 0; frame < frameCount; frame++) {
    step(state);
  }
}

function measureNoop(frameCount) {
  let time = 0;
  const start = performance.now();

  for (let frame = 0; frame < frameCount; frame++) {
    time += DT;
  }

  return performance.now() - start;
}

function benchmarkScene({ createState, step, warmupFrames, measureFrames }) {
  const state = createState();
  runFrames(warmupFrames, step, state);
  const noopMs = measureNoop(measureFrames);
  const start = performance.now();
  runFrames(measureFrames, step, state);
  const totalMs = performance.now() - start;
  const correctedMs = Math.max(totalMs - noopMs, 0);

  return {
    correctedMs,
    frameCount: measureFrames,
    msPerFrame: correctedMs / measureFrames,
  };
}

function benchmarkCurrentScene() {
  for (const frameCount of CURRENT_MEASURE_FRAME_COUNTS) {
    const result = benchmarkScene({
      createState: createCurrentState,
      step: stepCurrentCombined,
      warmupFrames: CURRENT_WARMUP_FRAMES,
      measureFrames: frameCount,
    });

    if (result.correctedMs > 0) {
      return result;
    }
  }

  return benchmarkScene({
    createState: createCurrentState,
    step: stepCurrentCombined,
    warmupFrames: CURRENT_WARMUP_FRAMES,
    measureFrames: CURRENT_MEASURE_FRAME_COUNTS.at(-1),
  });
}

const scenes = REPRESENTATIVE_SCENE_SEEDS.map((seed) =>
  createRepresentativeScene(seed),
);
const kelpCounts = scenes.map((scene) => scene.kelpCount);
const kelpVertexCounts = scenes.map((scene) => scene.kelpVertexCount);
const waterVertexCounts = scenes.map((scene) => scene.waterVertexCount);

const legacyKelpBenchmarks = scenes.map((scene) =>
  benchmarkScene({
    createState: () => createLegacyKelpState(scene),
    step: stepLegacyKelp,
    warmupFrames: LEGACY_WARMUP_FRAMES,
    measureFrames: LEGACY_MEASURE_FRAMES,
  }),
);

const legacyWaterBenchmarks = scenes.map((scene) =>
  benchmarkScene({
    createState: () => createLegacyWaterState(scene),
    step: stepLegacyWater,
    warmupFrames: LEGACY_WARMUP_FRAMES,
    measureFrames: LEGACY_MEASURE_FRAMES,
  }),
);

const legacyCombinedBenchmarks = scenes.map((scene) =>
  benchmarkScene({
    createState: () => createLegacyCombinedState(scene),
    step: stepLegacyCombined,
    warmupFrames: LEGACY_WARMUP_FRAMES,
    measureFrames: LEGACY_MEASURE_FRAMES,
  }),
);

const currentBenchmarks = scenes.map(() => benchmarkCurrentScene());

const legacyKelpMsPerFrame = mean(
  legacyKelpBenchmarks.map((entry) => entry.msPerFrame),
);
const legacyWaterMsPerFrame = mean(
  legacyWaterBenchmarks.map((entry) => entry.msPerFrame),
);
const legacyCombinedMsPerFrame = mean(
  legacyCombinedBenchmarks.map((entry) => entry.msPerFrame),
);
const currentMsPerFrame = mean(
  currentBenchmarks.map((entry) => entry.msPerFrame),
);
const savedMsPerFrame = legacyCombinedMsPerFrame - currentMsPerFrame;
const reductionPercent =
  legacyCombinedMsPerFrame > 0
    ? (savedMsPerFrame / legacyCombinedMsPerFrame) * 100
    : 0;

const reportLines = [
  "Environment animation profile",
  "=============================",
  `Representative scenes: ${REPRESENTATIVE_SCENE_SEEDS.length} seeded 5x5 flora rings around the player origin`,
  `Flora density scale: ${FLORA_DENSITY_SCALE} (matches the default high-quality runtime tier)`,
  `Water surface: ${WATER_SURFACE_WIDTH}x${WATER_SURFACE_HEIGHT} plane with ${WATER_SURFACE_SEGMENTS}x${WATER_SURFACE_SEGMENTS} segments`,
  `Legacy benchmark frames: ${LEGACY_MEASURE_FRAMES} after ${LEGACY_WARMUP_FRAMES} warmup`,
  `Current benchmark frames: ${currentBenchmarks[0].frameCount} after ${CURRENT_WARMUP_FRAMES} warmup`,
  "",
  "Representative scene stats (mean across seeds)",
  `- Kelp meshes: ${mean(kelpCounts).toFixed(1)}`,
  `- Kelp vertices touched per frame by the legacy CPU sway loop: ${Math.round(mean(kelpVertexCounts)).toLocaleString()}`,
  `- Water vertices touched per frame by the legacy CPU wave loop: ${Math.round(mean(waterVertexCounts)).toLocaleString()}`,
  `- Total legacy per-frame scalar writes before GPU upload: ${(Math.round(mean(kelpVertexCounts)) + Math.round(mean(waterVertexCounts))).toLocaleString()}`,
  "- Current steady-state per-frame writes on the primary path: 2 uniform values",
  "",
  "Timing (corrected main-thread cost, mean across seeds)",
  `- Legacy kelp CPU loop: ${formatMs(legacyKelpMsPerFrame)} per frame`,
  `- Legacy water CPU loop: ${formatMs(legacyWaterMsPerFrame)} per frame`,
  `- Legacy combined environment animation: ${formatMs(legacyCombinedMsPerFrame)} per frame`,
  `- Current combined environment animation: ${formatMs(currentMsPerFrame)} per frame`,
  `- Main-thread time saved: ${formatMs(savedMsPerFrame)} per frame (${formatPercent(reductionPercent)})`,
  "",
  "Notes",
  "- The legacy benchmark replays the removed JavaScript loops on representative kelp tube geometry and the shipped water mesh topology.",
  "- The current benchmark measures the steady-state uniform updates used by the GPU-driven path.",
  "- These numbers exclude renderer-side buffer uploads from position.needsUpdate, so the observed savings are conservative.",
];

for (const line of reportLines) {
  console.log(line);
}
