---
name: threejs-webgpu-guides
description: "Reference index for Three.js rendering, lighting, shadows, materials, textures, post-processing, shaders, scene graphs, disposal, optimization, cameras, physics, and WebGPU topics. Use when researching WGSL, compute shaders, GPU memory layout, bind groups, render bundles, migration tradeoffs, architectural patterns, or production best practices. Covers the Three.js manual, WebGPU Fundamentals, WebGPU Best Practices (toji.dev), and Tour of WGSL."
argument-hint: "Describe the Three.js or WebGPU topic to research"
---

# Three.js & WebGPU Guides

Curated index of tutorial-style conceptual content — explanations, tradeoffs, diagrams, and patterns — from the [Three.js manual](https://threejs.org/manual/), [WebGPU Fundamentals](https://webgpufundamentals.org/), [WebGPU Best Practices](https://toji.dev/webgpu-best-practices/), and [Tour of WGSL](https://google.github.io/tour-of-wgsl/). Use this skill when you need the "why" behind a rendering or GPU feature, not just the "what".

> **Conceptual Guides vs API Docs:** This skill indexes conceptual guides and best-practice articles. Use it for explanations, tradeoffs, and workflow patterns. For API details, use Context7 (`/mrdoob/three.js`) for Three.js or browse MDN/spec pages directly for raw WebGPU API reference.

## Choose the Right Source

- **Three.js manual** — renderer-level abstractions, materials, lights, shadows, post-processing, loading, scene architecture, and game-oriented patterns
- **WebGPU Fundamentals** — raw WebGPU pipeline concepts, WGSL basics, GPU memory layout, buffers, textures, compute shaders, and WebGL → WebGPU migration
- **Tour of WGSL** — WGSL language semantics and binding rules, especially uniformity analysis and shader authoring pitfalls
- **toji.dev Best Practices** — production patterns for buffer uploads, bind groups, render bundles, device loss, error handling, and GPU profiling

## When to Use

- Implementing or debugging **rendering, lighting, shadows, materials, post-processing, fog, cameras, textures, shaders, disposal, or optimization**
- Evaluating **tradeoffs** (e.g. shadow map resolution vs frustum area, PointLight shadow cost, MeshPhongMaterial vs MeshStandardMaterial)
- Understanding **architectural patterns** (scene graph hierarchy, render target usage, EffectComposer pass ordering)
- **WebGPU migration** — the manual has dedicated WebGPU chapters
- **WebGPU internals** — WGSL language, compute shaders, GPU memory layout, buffer/texture binding, optimization and debugging at the GPU pipeline level
- **WebGPU best practices** — buffer uploads, bind group architecture, render bundles, error handling, device loss, GPU profiling
- **Debugging** visual glitches, shader errors, or GPU-side performance issues

## Procedure

1. Choose the most relevant source using the guide above
2. Find the relevant topic(s) in the index below
3. Use `fetch_webpage` with one or more URLs and a focused query string
4. Cross-reference multiple pages when reviewing design or performance tradeoffs

Multiple pages may be relevant for a single task — fetch all that apply.

## Topic Index

### Core Concepts

| Topic             | URL                                               | Use when...                                                    |
| ----------------- | ------------------------------------------------- | -------------------------------------------------------------- |
| Fundamentals      | `https://threejs.org/manual/en/fundamentals.html` | Understanding Renderer → Scene → Camera → Mesh architecture    |
| Scene Graph       | `https://threejs.org/manual/en/scenegraph.html`   | Parent-child transforms, Object3D hierarchy, coordinate spaces |
| Responsive Design | `https://threejs.org/manual/en/responsive.html`   | Canvas resize handling, pixel ratio, aspect ratio              |

### Rendering & Visual

| Topic                 | URL                                                        | Use when...                                                                                   |
| --------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Materials             | `https://threejs.org/manual/en/materials.html`             | Choosing material types, understanding MeshBasic vs MeshPhong vs MeshStandard vs MeshPhysical |
| Textures              | `https://threejs.org/manual/en/textures.html`              | Texture loading, filtering, wrapping, mipmaps, repeat                                         |
| Lights                | `https://threejs.org/manual/en/lights.html`                | Light types, intensity, color, helpers, performance cost per type                             |
| Shadows               | `https://threejs.org/manual/en/shadows.html`               | Shadow maps, frustum tuning, resolution tradeoffs, fake shadows, PointLight 6x cost           |
| Cameras               | `https://threejs.org/manual/en/cameras.html`               | Perspective vs Orthographic, frustum, near/far, aspect, multi-camera                          |
| Fog                   | `https://threejs.org/manual/en/fog.html`                   | Linear vs exponential fog, fog + material interactions                                        |
| Color Management      | `https://threejs.org/manual/en/color-management.html`      | sRGB, linear workflow, color space, tone mapping                                              |
| Render Targets        | `https://threejs.org/manual/en/rendertargets.html`         | Offscreen rendering, render-to-texture patterns                                               |
| Custom BufferGeometry | `https://threejs.org/manual/en/custom-buffergeometry.html` | Vertex attributes, indices, normals, procedural geometry                                      |
| Primitives            | `https://threejs.org/manual/en/primitives.html`            | Built-in geometry types and their parameter spaces                                            |
| Transparency          | `https://threejs.org/manual/en/transparency.html`          | Sorting, depthWrite, blending, rendering transparent objects                                  |
| Billboards & Facades  | `https://threejs.org/manual/en/billboards.html`            | Camera-facing quads, LOD impostors                                                            |

### Advanced Shaders & Rendering Techniques

Advanced shader patterns, material comparisons, and GPU-side selection techniques beyond basic rendering setup.

| Topic             | URL                                                   | Use when...                                        |
| ----------------- | ----------------------------------------------------- | -------------------------------------------------- |
| Uniform Types     | `https://threejs.org/manual/en/uniform-types.html`    | GLSL uniform type mapping, passing data to shaders |
| Shadertoy Shaders | `https://threejs.org/manual/en/shadertoy.html`        | Porting Shadertoy shaders to Three.js              |
| Indexed Textures  | `https://threejs.org/manual/en/indexed-textures.html` | Using data textures for picking and coloring       |
| Picking           | `https://threejs.org/manual/en/picking.html`          | Raycasting, GPU picking, object selection          |
| Material Table    | `https://threejs.org/manual/en/material-table.html`   | Quick-reference comparison of all material types   |

### Post-Processing

| Topic                      | URL                                                             | Use when...                                                            |
| -------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Post-Processing (tutorial) | `https://threejs.org/manual/en/post-processing.html`            | EffectComposer setup, pass ordering, RenderPass → effects → OutputPass |
| Post-Processing (how-to)   | `https://threejs.org/manual/en/how-to-use-post-processing.html` | ShaderPass, custom effects, GlitchPass, pass chain mechanics           |

### Optimization & Performance

| Topic                       | URL                                                                    | Use when...                                             |
| --------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------- |
| Optimizing Lots of Objects  | `https://threejs.org/manual/en/optimize-lots-of-objects.html`          | Merging geometry, instancing, reducing draw calls       |
| Optimizing Animated Objects | `https://threejs.org/manual/en/optimize-lots-of-objects-animated.html` | Morphed merged geometry, data textures for animation    |
| OffscreenCanvas / Workers   | `https://threejs.org/manual/en/offscreencanvas.html`                   | Moving rendering off the main thread                    |
| Rendering On Demand         | `https://threejs.org/manual/en/rendering-on-demand.html`               | Skipping frames when nothing changes, reducing GPU load |

### Resource Management

| Topic                | URL                                                            | Use when...                                                     |
| -------------------- | -------------------------------------------------------------- | --------------------------------------------------------------- |
| Disposing of Objects | `https://threejs.org/manual/en/how-to-dispose-of-objects.html` | Geometry/material/texture disposal, preventing GPU memory leaks |
| Freeing Resources    | `https://threejs.org/manual/en/cleanup.html`                   | Scene teardown, cleanup patterns, switching scenes              |
| Updating Things      | `https://threejs.org/manual/en/how-to-update-things.html`      | BufferAttribute updates, needsUpdate flags, dynamic geometry    |

### Animation & Physics

| Topic                  | URL                                                         | Use when...                                                   |
| ---------------------- | ----------------------------------------------------------- | ------------------------------------------------------------- |
| Animation System       | `https://threejs.org/manual/en/animation-system.html`       | AnimationMixer, AnimationClip, keyframe tracks, blending      |
| Matrix Transformations | `https://threejs.org/manual/en/matrix-transformations.html` | Manual matrix manipulation, worldToLocal, local-to-world      |
| Physics                | `https://threejs.org/manual/en/physics.html`                | Physics engine integration patterns (Ammo.js, Rapier, Cannon) |

### Loading & Assets

| Topic                | URL                                                    | Use when...                                           |
| -------------------- | ------------------------------------------------------ | ----------------------------------------------------- |
| Loading 3D Models    | `https://threejs.org/manual/en/loading-3d-models.html` | glTF, OBJ, format comparison, loader selection        |
| Load glTF            | `https://threejs.org/manual/en/load-gltf.html`         | GLTFLoader specifics, animations, materials from glTF |
| Load OBJ             | `https://threejs.org/manual/en/load-obj.html`          | OBJLoader, MTL materials                              |
| Backgrounds / Skybox | `https://threejs.org/manual/en/backgrounds.html`       | Scene background, environment maps, skybox setup      |
| Canvas Textures      | `https://threejs.org/manual/en/canvas-textures.html`   | Dynamic 2D canvas → Three.js texture (HUD, labels)    |

### Game Development

Core patterns for building Three.js games and procedural world systems.

| Topic               | URL                                                 | Use when...                                             |
| ------------------- | --------------------------------------------------- | ------------------------------------------------------- |
| Start Making a Game | `https://threejs.org/manual/en/game.html`           | Game loop patterns, game architecture in Three.js       |
| Voxel Geometry      | `https://threejs.org/manual/en/voxel-geometry.html` | Procedural voxel world generation, chunk-based geometry |

### WebGPU

| Topic                  | URL                                                        | Use when...                                                     |
| ---------------------- | ---------------------------------------------------------- | --------------------------------------------------------------- |
| WebGPURenderer         | `https://threejs.org/manual/en/webgpurenderer.html`        | Migrating from WebGLRenderer, WebGPU setup, feature differences |
| WebGPU Post-Processing | `https://threejs.org/manual/en/webgpu-postprocessing.html` | Post-processing differences under WebGPU                        |

### Debugging

| Topic                | URL                                                       | Use when...                                                             |
| -------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------- |
| Debugging JavaScript | `https://threejs.org/manual/en/debugging-javascript.html` | Common Three.js debugging patterns, DevTools tips                       |
| Debugging GLSL       | `https://threejs.org/manual/en/debugging-glsl.html`       | Shader compilation errors, visual debugging techniques                  |
| Tips                 | `https://threejs.org/manual/en/tips.html`                 | Screenshots, preserveDrawingBuffer, canvas transparency, keyboard input |

---

## WebGPU Fundamentals (Supplementary Source)

[WebGPU Fundamentals](https://webgpufundamentals.org/) is a separate tutorial site covering the WebGPU API and WGSL at the GPU pipeline level — below the abstraction layer that Three.js provides. Use these pages when you need to understand **how the GPU works** beneath Three.js, not just how Three.js wraps it.

> These pages teach raw WebGPU concepts. Three.js abstracts most of this, but understanding the underlying pipeline helps debug render issues, write custom shaders/TSL nodes, optimize buffer usage, and reason about WebGPU migration.

### GPU Pipeline & Basics

| Topic                 | URL                                                                               | Use when...                                                          |
| --------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| WebGPU Fundamentals   | `https://webgpufundamentals.org/webgpu/lessons/webgpu-fundamentals.html`          | Understanding the GPU pipeline: device, command encoder, render pass |
| How It Works          | `https://webgpufundamentals.org/webgpu/lessons/webgpu-how-it-works.html`          | Mental model of vertex → rasterization → fragment pipeline stages    |
| Inter-stage Variables | `https://webgpufundamentals.org/webgpu/lessons/webgpu-inter-stage-variables.html` | Passing data from vertex to fragment shader (varyings)               |
| Compatibility Mode    | `https://webgpufundamentals.org/webgpu/lessons/webgpu-compatibility-mode.html`    | WebGPU on non-native backends, fallback behavior                     |

### WGSL Language

| Topic                   | URL                                                                                 | Use when...                                                          |
| ----------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| WGSL Overview           | `https://webgpufundamentals.org/webgpu/lessons/webgpu-wgsl.html`                    | WGSL syntax, types, built-ins — essential for custom TSL/shader work |
| WGSL Function Reference | `https://webgpufundamentals.org/webgpu/lessons/webgpu-wgsl-function-reference.html` | Quick lookup of WGSL built-in functions (math, texture, atomic)      |
| Constants               | `https://webgpufundamentals.org/webgpu/lessons/webgpu-constants.html`               | Pipeline-overridable constants, specialization                       |

### Buffers & Memory

| Topic              | URL                                                                            | Use when...                                              |
| ------------------ | ------------------------------------------------------------------------------ | -------------------------------------------------------- |
| Data Memory Layout | `https://webgpufundamentals.org/webgpu/lessons/webgpu-memory-layout.html`      | Struct alignment, padding, buffer layout debugging       |
| Uniforms           | `https://webgpufundamentals.org/webgpu/lessons/webgpu-uniforms.html`           | Uniform buffer binding, update patterns                  |
| Storage Buffers    | `https://webgpufundamentals.org/webgpu/lessons/webgpu-storage-buffers.html`    | Read/write GPU buffers, SSBO equivalent                  |
| Vertex Buffers     | `https://webgpufundamentals.org/webgpu/lessons/webgpu-vertex-buffers.html`     | Vertex attribute layout, interleaved vs separate buffers |
| Bind Group Layouts | `https://webgpufundamentals.org/webgpu/lessons/webgpu-bind-group-layouts.html` | Resource binding architecture, group/binding slots       |
| Copying Data       | `https://webgpufundamentals.org/webgpu/lessons/webgpu-copying-data.html`       | Buffer-to-buffer, buffer-to-texture transfers            |

### Textures (WebGPU-level)

| Topic                   | URL                                                                            | Use when...                                                   |
| ----------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| Textures                | `https://webgpufundamentals.org/webgpu/lessons/webgpu-textures.html`           | Sampler, texture view, mip levels at the GPU API level        |
| Loading Images          | `https://webgpufundamentals.org/webgpu/lessons/webgpu-importing-textures.html` | Image → GPU texture upload patterns                           |
| Storage Textures        | `https://webgpufundamentals.org/webgpu/lessons/webgpu-storage-textures.html`   | Write-to-texture from compute/fragment, imageStore equivalent |
| Cube Maps               | `https://webgpufundamentals.org/webgpu/lessons/webgpu-cube-maps.html`          | Cubemap creation and sampling at the GPU level                |
| Multisampling / MSAA    | `https://webgpufundamentals.org/webgpu/lessons/webgpu-multisampling.html`      | MSAA resolve, sample count, multisample render targets        |
| Transparency & Blending | `https://webgpufundamentals.org/webgpu/lessons/webgpu-transparency.html`       | Blend state config, alpha compositing at the pipeline level   |

### Compute Shaders

| Topic                  | URL                                                                                          | Use when...                                                     |
| ---------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Compute Shader Basics  | `https://webgpufundamentals.org/webgpu/lessons/webgpu-compute-shaders.html`                  | Workgroup layout, dispatch, shared memory — GPU-side simulation |
| Image Histogram        | `https://webgpufundamentals.org/webgpu/lessons/webgpu-compute-shaders-histogram.html`        | Practical compute example: parallel reduction, atomics          |
| Image Histogram Part 2 | `https://webgpufundamentals.org/webgpu/lessons/webgpu-compute-shaders-histogram-part-2.html` | Advanced atomics, workgroup optimization patterns               |

### WebGPU Optimization & Debugging

| Topic                  | URL                                                                             | Use when...                                                    |
| ---------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Speed and Optimization | `https://webgpufundamentals.org/webgpu/lessons/webgpu-optimization.html`        | Draw call batching, pipeline caching, GPU profiling strategies |
| Debugging and Errors   | `https://webgpufundamentals.org/webgpu/lessons/webgpu-debugging.html`           | Validation errors, lost device, error scopes, debugging tools  |
| Timing Performance     | `https://webgpufundamentals.org/webgpu/lessons/webgpu-timing.html`              | GPU timestamp queries, measuring render/compute pass duration  |
| Limits and Features    | `https://webgpufundamentals.org/webgpu/lessons/webgpu-limits-and-features.html` | Device capability detection, optional feature negotiation      |

### Migration

| Topic             | URL                                                                    | Use when...                                                  |
| ----------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------ |
| WebGPU from WebGL | `https://webgpufundamentals.org/webgpu/lessons/webgpu-from-webgl.html` | Conceptual mapping from WebGL patterns to WebGPU equivalents |

---

## Tour of WGSL (Supplementary Source)

[Tour of WGSL](https://google.github.io/tour-of-wgsl/) is an interactive WGSL tutorial and reference. The prose is lighter than WebGPU Fundamentals, but it is especially useful for language semantics that frequently trip up shader authors.

> Use Tour of WGSL for WGSL syntax and semantics. Use WebGPU Fundamentals for broader pipeline concepts. The uniformity pages are especially useful when debugging shader errors around control flow, derivatives, and texture sampling.

| Topic               | URL                                                          | Use when...                                                                         |
| ------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Tour of WGSL        | `https://google.github.io/tour-of-wgsl/`                     | Navigating WGSL concepts and examples interactively                                 |
| Binding Points      | `https://google.github.io/tour-of-wgsl/binding-points/`      | Mapping `@group`/`@binding` declarations to uniforms, storage buffers, and textures |
| Uniformity Analysis | `https://google.github.io/tour-of-wgsl/uniformity-analysis/` | Debugging control-flow restrictions around derivatives and texture sampling         |

---

## WebGPU Best Practices — toji.dev (Supplementary Source)

[WebGPU Best Practices](https://toji.dev/webgpu-best-practices/) by Brandon Jones (Chrome WebGPU team lead) covers practical patterns and pitfalls for specific parts of the WebGPU API. These are not tutorials — they assume you know the basics and focus on production patterns.

> These articles complement WebGPU Fundamentals: Fundamentals explains how the API works. toji.dev explains the safest and most efficient patterns for using it in real applications.

### Buffer & Resource Patterns

| Topic                       | URL                                                     | Use when...                                                                      |
| --------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Buffer Uploads              | `https://toji.dev/webgpu-best-practices/buffer-uploads` | `writeBuffer()` vs `mappedAtCreation` vs staging ring uploads                    |
| Image/Canvas/Video Textures | `https://toji.dev/webgpu-best-practices/img-textures`   | Loading textures from images, canvases, and video elements into WebGPU           |
| Bind Groups                 | `https://toji.dev/webgpu-best-practices/bind-groups`    | Bind group architecture, frequency-of-change grouping, `layout: 'auto'` pitfalls |

### Rendering Patterns

| Topic                    | URL                                                          | Use when...                                                             |
| ------------------------ | ------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Render Bundles           | `https://toji.dev/webgpu-best-practices/render-bundles`      | Reducing CPU overhead with pre-recorded command bundles                 |
| Indirect Draws           | `https://toji.dev/webgpu-best-practices/indirect-draws`      | GPU-driven draw calls and indirect buffer patterns                      |
| Compute with Vertex Data | `https://toji.dev/webgpu-best-practices/compute-vertex-data` | Alignment restrictions when manipulating vertex data in compute shaders |

### Shader & Pipeline Patterns

| Topic                       | URL                                                                  | Use when...                                     |
| --------------------------- | -------------------------------------------------------------------- | ----------------------------------------------- |
| Dynamic Shader Construction | `https://toji.dev/webgpu-best-practices/dynamic-shader-construction` | Building shader variants without a preprocessor |

### Error Handling & Robustness

| Topic          | URL                                                     | Use when...                                         |
| -------------- | ------------------------------------------------------- | --------------------------------------------------- |
| Error Handling | `https://toji.dev/webgpu-best-practices/error-handling` | Error scopes, validation errors, and debugging flow |
| Device Loss    | `https://toji.dev/webgpu-best-practices/device-loss`    | Handling GPU device loss and recovery               |

### Performance Comparison & Profiling

| Topic                        | URL                                                                   | Use when...                                       |
| ---------------------------- | --------------------------------------------------------------------- | ------------------------------------------------- |
| WebGL Performance Comparison | `https://toji.dev/webgpu-best-practices/webgl-performance-comparison` | Comparing WebGPU and WebGL variants fairly        |
| Profiling with PIX           | `https://toji.dev/webgpu-profiling/pix`                               | Profiling Chrome WebGPU on Windows with PIX       |
| Profiling with RenderDoc     | `https://toji.dev/webgpu-profiling/renderdoc`                         | Profiling Chrome WebGPU on Windows with RenderDoc |
| Profiling with Xcode         | `https://toji.dev/webgpu-profiling/xcode`                             | Profiling Chrome WebGPU on macOS with Xcode       |

### Case Study

| Topic                    | URL                                              | Use when...                                                             |
| ------------------------ | ------------------------------------------------ | ----------------------------------------------------------------------- |
| Efficient glTF Rendering | `https://toji.github.io/webgpu-gltf-case-study/` | Studying real-world WebGPU patterns for glTF rendering and optimization |

## Example Usage

When fixing a shadow rendering issue:

```
fetch_webpage(
  urls: ["https://threejs.org/manual/en/shadows.html"],
  query: "shadow map frustum resolution tradeoff"
)
```

When reviewing a WebGPU migration PR:

```
fetch_webpage(
  urls: [
    "https://threejs.org/manual/en/webgpurenderer.html",
    "https://webgpufundamentals.org/webgpu/lessons/webgpu-from-webgl.html"
  ],
  query: "WebGPURenderer differences from WebGLRenderer setup WebGL to WebGPU migration concepts"
)
```

When debugging a WGSL uniformity error:

```
fetch_webpage(
  urls: [
    "https://google.github.io/tour-of-wgsl/uniformity-analysis/",
    "https://google.github.io/tour-of-wgsl/binding-points/"
  ],
  query: "uniformity analysis texture sampling derivatives control flow group binding"
)
```

When optimizing frequent WebGPU buffer updates:

```
fetch_webpage(
  urls: [
    "https://toji.dev/webgpu-best-practices/buffer-uploads",
    "https://toji.dev/webgpu-best-practices/bind-groups"
  ],
  query: "writeBuffer mappedAtCreation staging ring bind groups frequency of change"
)
```

When debugging a material disposal leak:

```
fetch_webpage(
  urls: [
    "https://threejs.org/manual/en/how-to-dispose-of-objects.html",
    "https://threejs.org/manual/en/cleanup.html"
  ],
  query: "dispose geometry material texture GPU memory"
)
```
