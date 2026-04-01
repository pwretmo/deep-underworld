---
name: deep-ocean-horror-design
description: "Design guidance for deep-ocean horror in deep-underworld. Use when designing or reviewing creatures, biomes, encounters, lighting, audio, HUD pressure, pacing, environmental storytelling, or art direction so the game feels like deep-ocean horror instead of generic underwater fantasy."
argument-hint: "Describe the design target: biome, creature, encounter, ambience, sequence, or system"
---

# Deep-Ocean Horror Design

Translate ocean science and fear psychology into concrete design decisions for deep-underworld. Use it when the real question is not just what should happen, but what makes the idea feel specifically like deep-ocean horror.

For implementation details, pair this with `threejs-webgpu-guides`. For live validation after changes, pair it with `ux-testing`.

## When to Use

- Designing a new biome, depth zone, encounter, creature, or set piece
- Reviewing whether a scene feels truly oppressive or merely dark
- Converting scientific or thematic research into actionable game direction
- Tightening ambience, pacing, and environmental storytelling
- Generating art-direction notes for lighting, audio, VFX, HUD pressure, or traversal
- Stress-testing whether a concept preserves mystery while staying readable and playable

## Core Pillars

Deep-ocean horror usually comes from five drivers:

1. **Hostile physics** - darkness, cold, pressure, limited visibility, fragile survival systems
2. **Vastness** - huge spaces, weak landmarks, uncertain scale, vertical voids
3. **Unknowns** - incomplete information, delayed identification, unresolved ambiguity
4. **Grounded alien life** - strange biology that feels adapted, not random
5. **Isolation** - dependence on limited equipment, support, and readable signals

If a beat does not express at least one pillar clearly, it will usually drift toward generic action or fantasy.

## Fear Axes

Choose one primary fear axis first. Add one secondary axis only if it sharpens the beat.

| Fear axis | Use when you want the player to feel... | Typical design expression |
| --- | --- | --- |
| Unknown | they cannot tell what is present or what it means | silhouettes, partial sonar, distant movement, obscured forms |
| Vastness | they are tiny and exposed in a huge space | long drop-offs, weak landmarks, vertical voids, horizon loss |
| Isolation | they are alone and unsupported | radio gaps, sparse music, no safe retreat, delayed feedback |
| Predation | something is studying, shadowing, or hunting them | lure lights, circling motion, ambush routes, trailing sounds |
| Fragility | survival depends on failing systems | flickering lights, drained battery, oxygen pressure, damaged sensors |
| Corruption | the environment is wrong in a way the player can sense | warped fauna, failed equipment, unnatural geometry, contaminated water |

## Design Procedure

1. Define the target.
   Example: "Design a kelp-trench traversal beat that feels isolating rather than combat-heavy."
2. Pick the primary fear axis and one supporting axis.
3. Decide which player dependency is under pressure.
   Examples: light, oxygen, orientation, movement, sonar, or trust in the HUD.
4. Choose one environmental signal, one ambiguous signal, and one payoff.
   Example: distant clicking, vanishing fish, then a lure creature reveal.
5. Ground the beat in ecology or world logic.
   Ask: why does this creature, light, ruin, or hazard exist here?
6. Translate the beat across at least two disciplines.
   Example: lighting + audio, or encounter design + HUD behavior.
7. Check readability.
   The player should be stressed, not blind to required decisions.
8. End with concrete output.
   Produce design notes, a short implementation brief, and a validation checklist.

For detailed environment, audio, creature, encounter, HUD, and anti-pattern heuristics, use [design patterns](./references/design-patterns.md).

## Recommended Output Shape

When using this skill, structure the result as:

1. **Intent** - what feeling the design should create
2. **Primary fear axis** - the main driver of dread
3. **Concrete design moves** - changes to visuals, audio, pacing, systems, and encounter logic
4. **Grounding logic** - why the beat makes sense in this world
5. **Failure risks** - how the idea could become generic, unfair, or visually muddy
6. **Validation checklist** - what to verify in implementation or playtest

Keep the output practical. Prefer a short design brief the implementation agent can act on without inventing missing tone rules.

## Repo-Specific Touchpoints

If the design needs implementation follow-through, these are likely starting points:

| Area | Likely files |
| --- | --- |
| Core game flow and survival state | `src/Game.js`, `src/player/Player.js` |
| Ocean look, fog, particles, ambience | `src/environment/Ocean.js`, `src/shaders/UnderwaterEffect.js`, `src/lighting/LightingPolicy.js` |
| Creature concepts and behavior | `src/creatures/` |
| Encounter structure | `src/encounters/AbyssEncounter.js` |
| Audio pressure and music | `src/audio/AudioManager.js`, `src/audio/MusicSystem.js` |
| HUD readability and player feedback | `src/ui/HUD.js` |

## Reference Basis

This skill is grounded in recurring deep-ocean fear drivers: darkness, pressure, cold, unexplored space, alien life, and fear of the unknown. If a design question needs fresh source material, check current first-party ocean science references before inventing lore around a false premise.