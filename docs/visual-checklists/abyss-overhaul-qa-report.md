# Abyss Overhaul Visual QA Report

Issue: #25

## Capture Setup

- Branch seed: `25`
- Resolution: `1600x900`
- Autoplay URL: `http://127.0.0.1:4177/?autoplay&seed=25`
- Manual URL: `http://127.0.0.1:4177/?seed=25`

## Evidence

### Manual Path

- Menu render before start: [assets/issue-25/manual-before-start.png](./assets/issue-25/manual-before-start.png)
- Gameplay after manual start: [assets/issue-25/manual-after-start.png](./assets/issue-25/manual-after-start.png)

### Flashlight Readability

- Before flashlight boost: [assets/issue-25/before-flashlight-readability.png](./assets/issue-25/before-flashlight-readability.png)
- After flashlight boost: [assets/issue-25/after-flashlight-readability.png](./assets/issue-25/after-flashlight-readability.png)

### Silhouette / Deep-Scene Framing

- Before silhouette comparison: [assets/issue-25/before-leviathan-silhouette.png](./assets/issue-25/before-leviathan-silhouette.png)
- After silhouette comparison: [assets/issue-25/after-leviathan-silhouette.png](./assets/issue-25/after-leviathan-silhouette.png)

### Additional Autoplay Captures

- Mid-depth autoplay frame: [assets/issue-25/autoplay-before-flashlight.png](./assets/issue-25/autoplay-before-flashlight.png)
- Mid-depth autoplay flashlight frame: [assets/issue-25/autoplay-after-flashlight.png](./assets/issue-25/autoplay-after-flashlight.png)
- Abyss autoplay frame: [assets/issue-25/autoplay-before-abyss.png](./assets/issue-25/autoplay-before-abyss.png)
- Abyss autoplay follow-up frame: [assets/issue-25/autoplay-after-abyss.png](./assets/issue-25/autoplay-after-abyss.png)

## Findings

- Autoplay path starts correctly, skips the menu, and keeps gameplay active without pointer-lock interaction.
- Manual path renders the menu correctly and enters gameplay after `Begin Descent`.
- Flashlight comparisons show a localized readability lift without obvious bloom blowout or UI clipping.
- Fog and exposure transitions remain smooth through the midnight-to-abyss descent captures; no hard step or missing fog state was observed in this pass.
- No major visual regressions were observed in this validation pass, although the abyss remains intentionally very dark and should continue to be checked against future creature or post-processing changes.

## Verification

- `npm run build` passed during this issue pass.
