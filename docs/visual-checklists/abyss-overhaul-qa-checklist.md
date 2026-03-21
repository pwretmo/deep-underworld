# Abyss Overhaul Visual QA Checklist

Use this pass to validate the abyss visual overhaul for regressions and to keep screenshot captures comparable across future changes.

## Test Setup

- Run the game with `npm run dev` or `npm run preview`.
- Use seed `25` for comparable captures: `http://localhost:5173/?autoplay&seed=25` and `http://localhost:5173/?seed=25`.
- Capture at `1600x900` so HUD layout and fog density are directly comparable.
- Record both autoplay and manual-start runs.

## Autoplay Pass

- Load `?autoplay&seed=25` and confirm the main menu is skipped.
- Let the run initialize, then capture a mid-depth frame around `212m` to `388m`.
- Capture an abyss frame around `760m` after the zone banner settles.
- Verify the HUD remains readable during automatic descent and no pause overlay appears unexpectedly.

## Manual Pass

- Load `?seed=25` and confirm the main menu renders correctly.
- Click `Begin Descent` and confirm gameplay begins without getting stuck on pointer lock.
- Capture one menu frame before starting and one gameplay frame after start.
- Verify HUD, crosshair, and radar remain visible once gameplay begins.

## Scene Checks

- Flashlight readability: compare the same framing with flashlight off and on. The beam should improve local readability without flattening the scene.
- Silhouette clarity: in midnight and abyss depths, large creature and structure shapes should still separate from the background enough to read their outline.
- Fog transition quality: zone transitions should feel continuous. Watch for abrupt exposure jumps, hard fog steps, or missing environmental color interpolation.
- Bloom stability: bioluminescent highlights and bright UI-adjacent effects should not pulse, clip, or disappear during steady camera framing.

## Pass Criteria

- Menu path works in manual mode.
- Autoplay path starts without manual input.
- No major visual regression is observed in flashlight response, silhouette readability, fog transition, or bloom behavior.
- Evidence images are updated or newly captured and linked from the associated issue or PR.
- `npm run build` completes successfully.
