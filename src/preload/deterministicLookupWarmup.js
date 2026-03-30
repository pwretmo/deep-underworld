import { noise2D } from '../utils/noise.js';

export const DETERMINISTIC_LOOKUP_WARMUP_SPEC = Object.freeze({
  gridRadius: 8,
  step: 0.07,
});

export function buildDeterministicLookupPlan({
  gridRadius = DETERMINISTIC_LOOKUP_WARMUP_SPEC.gridRadius,
  step = DETERMINISTIC_LOOKUP_WARMUP_SPEC.step,
} = {}) {
  const plan = [];

  for (let x = -gridRadius; x <= gridRadius; x++) {
    for (let z = -gridRadius; z <= gridRadius; z++) {
      plan.push({ x: x * step, z: z * step });
    }
  }

  return plan;
}

export function computeDeterministicLookupChecksum(plan = buildDeterministicLookupPlan()) {
  let checksum = 0;

  for (const point of plan) {
    checksum += noise2D(point.x, point.z);
  }

  return Number(checksum.toFixed(4));
}