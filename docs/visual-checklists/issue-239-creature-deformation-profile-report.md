# Creature Deformation Scaling Profile Report

Issue: #239

## Capture Setup

- Command: `npm run profile:creature-deformation`
- Benchmark source: `scripts/profile-creature-deformation.mjs`
- Scene counts: `4`, `8`, `16`, and `32` total affected near-tier creatures, evenly distributed across Jellyfish, DeepOne, MechOctopus, and SirenSkull (`1`, `2`, `4`, and `8` of each class per scene)
- DeepOne gating: one DeepOne per scene keeps the current hero-only normal budget (`HERO_NORMAL_INTERVAL = 3`); all remaining DeepOnes stay on the default near-tier path without per-frame normal recomputation
- Warmup frames: `90`
- Measured frames: `180`
- Seeds: `101, 202, 303, 404, 505, 606`
- Scope note: measures only the runtime deformation hot paths changed by issue `#239`, not unrelated AI, traversal, or rendering work

## Evidence

### Aggregate Mixed-Scene Frame Cost

| Total affected creatures | Legacy mean | Current mean | Delta | Legacy P95 | Current P95 | Delta | Legacy max | Current max | Delta |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `4` | `0.882 ms` | `0.314 ms` | `64.35%` lower | `1.328 ms` | `0.651 ms` | `50.96%` lower | `1.807 ms` | `0.883 ms` | `51.13%` lower |
| `8` | `3.006 ms` | `0.967 ms` | `67.83%` lower | `3.868 ms` | `1.406 ms` | `63.65%` lower | `4.093 ms` | `1.619 ms` | `60.44%` lower |
| `16` | `6.063 ms` | `1.773 ms` | `70.76%` lower | `7.809 ms` | `2.261 ms` | `71.04%` lower | `8.157 ms` | `2.480 ms` | `69.59%` lower |
| `32` | `12.177 ms` | `3.360 ms` | `72.41%` lower | `15.619 ms` | `3.881 ms` | `75.15%` lower | `16.151 ms` | `4.236 ms` | `73.77%` lower |

### Hot-Path Normal and Bounds Work Per Measured Frame

| Total affected creatures | Legacy normal recomputes / frame | Current normal recomputes / frame | Legacy bounds recomputes / frame | Current bounds recomputes / frame |
| --- | ---: | ---: | ---: | ---: |
| `4` | `23.00` | `4.67` | `19.00` | `0.00` |
| `8` | `45.88` | `4.67` | `37.88` | `0.00` |
| `16` | `91.38` | `4.67` | `75.38` | `0.00` |
| `32` | `183.13` | `4.67` | `151.13` | `0.00` |

### Scaling Slope Across the Count Sweep

| Metric | Legacy | Current | Delta |
| --- | ---: | ---: | ---: |
| Mean slope (`4` -> `32`) | `0.403 ms / creature` | `0.109 ms / creature` | `73.04%` lower |
| P95 slope (`4` -> `32`) | `0.510 ms / creature` | `0.115 ms / creature` | `77.40%` lower |

## Findings

- The current path scales materially better than the legacy deformation path across every measured count. Mean mixed-scene hot-path cost dropped from `0.882 ms` to `0.314 ms` at `4` affected creatures and from `12.177 ms` to `3.360 ms` at `32`, so the absolute savings grow from `0.568 ms` to `8.817 ms` as the scene fills up.
- Tail behavior improves with count instead of merely shifting the average. At `32` affected creatures the current path reduces the mixed-scene `P95` from `15.619 ms` to `3.881 ms`, which is a `75.15%` reduction.
- The legacy path’s normal and bounding-sphere work grows almost linearly with creature count, while the current path keeps normal recomputation flat at `4.67` calls per measured frame and eliminates per-frame bounds recomputation entirely. That flat normal count is the single hero-budgeted DeepOne (`14` tentacles recomputed every third frame) rather than scene-wide per-creature work.
- The benchmark keeps the feature behavior intact inside the measured scope. Jellyfish still evaluate nematocyst anchors analytically, DeepOne tentacles still deform on the CPU, SirenSkull membranes still update their trailing offsets, and MechOctopus mantle breathing still advances every frame; the win comes from removing or tightly gating the expensive normal and bounds recomputation, not from downgrading motion into static props.

## Verification

- `npm run profile:creature-deformation`
- `npm run build`
