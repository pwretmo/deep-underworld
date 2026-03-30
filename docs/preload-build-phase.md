# Preload Build-Phase Notes

## What Moved To Build Time

The deterministic non-audio lookup warmup now comes from a generated source artifact instead of an idle-frame loop in runtime. The build script lives at `scripts/generate-preload-lookup-artifact.mjs`, the shared spec is `src/preload/deterministicLookupWarmup.js`, and the generated output is `src/generated/preloadLookupArtifact.js`.

`PreloadCoordinator` still writes `lookupChecksum` into the startup snapshot so the advisory cache format stays stable. The runtime-only warmups are intentionally unchanged: GPU warmup, depth-band scene renders, flashlight warmup, bloom/perf fallback warmup, shadow-map priming, terrain/flora preload drains, and creature spawn drains still happen in-process because they depend on the active renderer, quality tier, and live scene state.

## What Blocks True Seeded Startup Artifacts

- `PreloadCoordinator.worldSeed` currently scopes the startup cache key and metadata, but it does not reach the procedural generators themselves.
- `src/utils/noise.js` seeds the shared noise tables with a fixed `seed(42)`, so the core terrain/noise field is global rather than world-seed-specific.
- `src/environment/chunkPayloadWorker.js` still uses `Math.random()` for rocks, coral branching, kelp variations, orb placement, tube worms, and other flora/terrain garnish, so worker payloads are not replayable from a world seed.
- Startup worker payloads are still tier-sensitive. `Flora` passes `floraDensityScale` from `QualityManager`, the terrain/flora startup window changes with `terrainViewDistance`, and `PreloadCoordinator` currently caches against a coarse pixel-ratio tier instead of the full runtime quality preset, so a build bake needs an explicit `(worldSeed, qualityTier)` contract rather than a single shared artifact.
- Meaningful GPU and shader warmup stays runtime-only. `PreloadCoordinator` still has to talk to the real renderer for `warmRender`, flashlight variants, bloom/perf fallbacks, shadow map priming, representative depth-band renders, and creature showcase renders.

## Highest-Value Next Bake Candidates

| Candidate | Why It Is Hot | Why It Is A Good Next Bake |
| --- | --- | --- |
| `Anglerfish` | `CreatureManager` queues three startup anglerfish. Each constructor builds displaced body geometry, multiple `TubeGeometry` curves, fin planes, jaw/fang detail, lure branches, and several randomized mesh loops. | Baking per-tier body and lure geometry would remove one of the heaviest repeated startup constructors while leaving runtime patrol, jaw, and lure animation intact. |
| `Jellyfish` | Startup queues two jellyfish immediately, and `Jellyfish.js` already has `SYNC_JELLY_LIMIT = 2` because the constructor is expensive. It generates multiple canvas textures plus detailed bell, arm, and tentacle assets. | Prebaking the static bell/tentacle meshes and reusable textures would directly reduce the first startup creature drain cost without touching runtime pulse animation. |
| `ChainDragger` | The near tier builds instanced torus-link chains, weighted end groups, barnacle detail, and allocates Verlet buffers during construction. | Bake the tier meshes and deterministic chain layouts, then keep the Verlet simulation runtime-only so interaction and sway still behave the same. |
| `MechOctopus` | The constructor creates a displaced mantle, chromatophores, rivets, web membranes, and eight tentacles with per-tier geometry differences. | Prebaking tier geometry would cut one of the deepest startup constructor spikes while preserving runtime breathing, eye, siphon, and tentacle motion. |
| `TubeCluster` | Startup places three `TubeCluster` colonies. Each one builds tiered tube colonies, shared canvas textures, worm/tube detail, and merged geometry paths. | These are stationary placements with limited gameplay state, so they are strong bake candidates once a seeded asset contract exists. |
| `PipeOrgan` | Startup places two `PipeOrgan` creatures, each with instanced pipes, root tendril `TubeGeometry`, membrane frills, and extra organ/polyp details. | A build bake could ship the static pipe and holdfast geometry while leaving resonance uniforms and retract/extend behavior runtime-side. |

## Suggested Seeded Payload Path

If the repo needs true build-time startup artifacts later, the minimum viable path is:

1. Introduce a shared seeded RNG utility that can run in both the browser and the chunk worker.
2. Pass `worldSeed` and explicit `qualityTier` inputs down into terrain/flora payload requests.
3. Replace worker-local `Math.random()` usage with the seeded RNG so identical `(worldSeed, qualityTier, chunk)` requests are replayable.
4. Decide which constructor outputs are pure data versus renderer/device warmups, and bake only the pure data side.

Until that exists, the current build artifact should stay limited to deterministic lookup checksums and other renderer-independent constants.
