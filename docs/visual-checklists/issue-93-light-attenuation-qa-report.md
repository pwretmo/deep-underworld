# Light Attenuation QA Report

Issue: #93

## Capture Setup

- Resolution: Browser default viewport from automation session
- Autoplay URL: `http://127.0.0.1:5174/?autoplay`
- Manual URL: `http://127.0.0.1:5174/`
- Note: `5173` was already occupied by another local dev server process in this environment, so this validation pass used `5174` for the worktree branch.

## Evidence

### Autoplay Depth Frames (Flashlight Off)

- Before shallow (~40m): [assets/issue-93/before-autoplay-shallow.png](./assets/issue-93/before-autoplay-shallow.png)
- After shallow (~40m): [assets/issue-93/after-autoplay-shallow.png](./assets/issue-93/after-autoplay-shallow.png)
- Before mid (~320m): [assets/issue-93/before-autoplay-mid.png](./assets/issue-93/before-autoplay-mid.png)
- After mid (~320m): [assets/issue-93/after-autoplay-mid.png](./assets/issue-93/after-autoplay-mid.png)
- Before abyss (~860m): [assets/issue-93/before-autoplay-abyss.png](./assets/issue-93/before-autoplay-abyss.png)
- After abyss (~860m): [assets/issue-93/after-autoplay-abyss.png](./assets/issue-93/after-autoplay-abyss.png)

### Manual Depth Frames (Flashlight On)

- Before shallow (~40m): [assets/issue-93/before-manual-shallow.png](./assets/issue-93/before-manual-shallow.png)
- After shallow (~40m): [assets/issue-93/after-manual-shallow.png](./assets/issue-93/after-manual-shallow.png)
- Before mid (~320m): [assets/issue-93/before-manual-mid.png](./assets/issue-93/before-manual-mid.png)
- After mid (~320m): [assets/issue-93/after-manual-mid.png](./assets/issue-93/after-manual-mid.png)
- Before abyss (~860m): [assets/issue-93/before-manual-abyss.png](./assets/issue-93/before-manual-abyss.png)
- After abyss (~860m): [assets/issue-93/after-manual-abyss.png](./assets/issue-93/after-manual-abyss.png)

## Findings

- Before this fix, a depth-proportional post-process multiplier darkened the entire composited frame, causing luminance to be crushed independently of scene lighting/fog.
- After the fix, depth mood remains driven by fog color/density, ambient falloff, tint, and exposure tuning rather than a separate depth-darkening multiplier.
- Flashlight readability remains stable through mid and abyss captures after adding depth-aware exposure compensation while the flashlight is active.
- No abrupt exposure/fog stepping was observed in this pass.
