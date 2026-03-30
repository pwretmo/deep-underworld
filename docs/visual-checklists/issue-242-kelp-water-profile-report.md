# Kelp + Water Animation Profile Report

Issue: #242

## Capture Setup

- Command: `npm run profile:environment-animation`
- Benchmark source: `scripts/profile-environment-animation.mjs`
- Scene model: 10 seeded representative scenes, each using the active 5x5 flora chunk ring around the player origin plus the shipped 2000x2000 / 100x100 water surface mesh
- Flora density: `1.0` to match the default `high` quality runtime tier

## Evidence

### Representative Scene Stats

- Mean kelp meshes per scene: `36.7`
- Mean kelp vertices touched every frame by the removed CPU sway loop: `2,104`
- Water vertices touched every frame by the removed CPU wave loop: `10,201`
- Total legacy per-frame scalar writes before GPU upload: `12,305`
- Current steady-state per-frame writes on the primary path: `2` uniform values

### Corrected Main-Thread Cost

- Legacy kelp CPU loop: `0.0027 ms/frame`
- Legacy water CPU loop: `0.164 ms/frame`
- Legacy combined environment animation: `0.165 ms/frame`
- Current combined environment animation: `0.000005296 ms/frame`
- Main-thread time saved on the primary path: `0.165 ms/frame` (`100.00%` reduction within the benchmark's measurement precision)

## Findings

- The removed steady-state CPU rewrite path touched roughly `12k` representative scalar vertex values per frame before any GPU upload work was considered.
- The current primary path reduces steady-state main-thread animation work to two uniform writes per frame while preserving the previous kelp and surface motion formulas on the GPU.
- The benchmark excludes renderer-side `position.needsUpdate` upload cost, so the measured savings are conservative relative to the full runtime win.

## Verification

- `npm run profile:environment-animation`
