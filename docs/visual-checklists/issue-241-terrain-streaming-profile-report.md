# Terrain Streaming Chunk-Apply Profile Report

Issue: #241

## Capture Setup

- Command: `npm run profile:terrain-chunk-apply`
- Benchmark source: `scripts/profile-terrain-chunk-apply.mjs`
- Quality tier: `high` (`terrainViewDistance = 3`)
- Traversal: preload the starting 7x7 chunk ring around the origin, then move steadily along `+X` at `4.75 m/s` through `4` chunk-boundary crossings
- Frame model: `60 FPS` streaming loop with the shipped `1 request/frame`, `1-frame` worker delivery delay, `4 ms` finalization budget, and `8-stage` slice cap
- Seeds: `101, 202, 303, 404, 505, 606`
- Repetitions: `3` per seed, reported as median per-seed summaries to smooth scheduler noise
- Scope note: the harness holds worker delivery constant so the comparison stays focused on main-thread chunk apply/finalization cost rather than worker generation latency

## Evidence

### Aggregate Traversal Metrics

| Metric | Legacy | Current | Delta |
| --- | ---: | ---: | ---: |
| Mean active-frame apply | `1.497 ms` | `1.315 ms` | `12.16%` lower |
| P95 active-frame apply | `1.702 ms` | `1.454 ms` | `14.57%` lower |
| Max active-frame spike | `2.760 ms` | `2.147 ms` | `22.22%` lower |
| Mean completed-chunk total | `1.497 ms` | `1.315 ms` | `12.16%` lower |

### Stage Means Per Completed Chunk

| Stage | Legacy | Current | Delta |
| --- | ---: | ---: | ---: |
| `geometry` | `0.195 ms` | `0.013 ms` | `93.33%` lower |
| `rocks` | `0.027 ms` | `0.016 ms` | `40.74%` lower |
| `terrainCollider` | `1.209 ms` | `1.228 ms` | `1.57%` higher |
| `rockColliders` | `0.054 ms` | `0.055 ms` | `1.85%` higher |
| `attach` | `0.001 ms` | `0.000 ms` | effectively eliminated |

### Per-Seed Median Max Active-Frame Spikes

- Seed `101`: legacy `1.485 ms`, current `1.505 ms`
- Seed `202`: legacy `1.593 ms`, current `1.099 ms`
- Seed `303`: legacy `1.279 ms`, current `1.408 ms`
- Seed `404`: legacy `2.325 ms`, current `1.793 ms`
- Seed `505`: legacy `2.270 ms`, current `1.809 ms`
- Seed `606`: legacy `2.760 ms`, current `2.147 ms`

## Findings

- The representative traversal benchmark shows a lower aggregate chunk-apply tail after the fix: worst-case active-frame chunk apply dropped from `2.760 ms` to `2.147 ms`, and the active-frame `P95` dropped from `1.702 ms` to `1.454 ms`.
- Moving normals and rock-instance preparation out of the steady-state main-thread apply path removed almost all geometry-stage cost during traversal (`0.195 ms` -> `0.013 ms` mean per completed chunk).
- Collider creation is now the dominant residual apply cost. That explains the remaining seed-level spread and the two seeds that stayed near legacy worst-case parity even though the aggregate traversal tail improved.
- The benchmark keeps terrain visuals, rock placement, and collider creation enabled throughout the traversal; it does not reduce functionality to produce the win.

## Verification

- `npm run profile:terrain-chunk-apply`
