# Jellyfish LOD Visual Comparison Checklist

Use this quick pass to compare the updated jellyfish visuals against older builds.

## Test Setup

- Start dev build and load the game in a jellyfish depth band.
- Test once with the player very close to a jellyfish cluster, once at medium range, and once far away.

## Before/After Checks

- Near range silhouette: bell edge should look rounded and organic, not noticeably faceted.
- Near range structure: inner membrane and rim frill should remain clearly visible.
- Medium range look: form should remain readable with reduced geometric detail.
- Far range look: jellyfish should keep recognizable shape while using simplified meshes.
- Animation continuity: pulsing, drift, and tentacle motion should remain smooth when crossing distance thresholds.
- Spawn/despawn behavior: jellyfish should still reappear around the player as before.
- Performance sanity: no obvious frame spikes while several jellyfish are visible at mixed ranges.

## Acceptance Notes

- Pass if close-range faceting is no longer obvious.
- Pass if LOD switches are not visually disruptive during normal play.
- Pass if no behavior regressions are observed in movement/spawn loop.
