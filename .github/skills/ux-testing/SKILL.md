---
name: ux-testing
description: "Browser-based UX testing for Three.js games using Chrome DevTools MCP — screenshots, keyboard input, console monitoring, performance tracing, memory analysis, Lighthouse audits, and dispatching fix workers."
---

# UX Testing Skill

How to play-test the deep-underworld game in a browser, find UX issues, and dispatch fixes.

## Starting the Dev Server

Run in a background terminal:

```bash
cd F:\repos\deep-underworld
npm run dev
```

Wait ~3 seconds, then open `http://localhost:5173`.

## Browser Interaction Patterns

### Opening the game

```
mcp_io_github_chr_new_page
  url: "http://localhost:5173"
```

### Taking a screenshot

```
mcp_io_github_chr_take_screenshot
```

### Reading what's on screen

```
mcp_io_github_chr_take_snapshot
```

Returns the accessibility tree with element references for clickable elements.

### Playing the game

```
# Click the canvas to capture pointer lock
mcp_io_github_chr_click  element: "canvas"

# Move forward
mcp_io_github_chr_press_key  key: "w"

# Look around
mcp_io_github_chr_press_key  key: "ArrowLeft"

# Open menu
mcp_io_github_chr_press_key  key: "Escape"
```

### Querying game state via JavaScript

```
mcp_io_github_chr_evaluate_script
  expression: "(() => {
    const game = window.game;
    if (!game) return { error: 'game not found on window' };
    return {
      playerPos: game.player?.position,
      fps: game.fps,
      creatureCount: game.creatureManager?.creatures?.length,
      depth: game.player?.depth
    };
  })()"
```

> **Tip**: If `window.game` isn't exposed, search the source for how the
> Game instance is created and find the right global reference.

### Checking console errors

```
mcp_io_github_chr_list_console_messages
```

Filter for errors and warnings in the results.

### Performance trace

```
mcp_io_github_chr_performance_start_trace
```

Returns Core Web Vitals and performance summary.

### Memory snapshot

```
mcp_io_github_chr_take_memory_snapshot
```

### Lighthouse audit

```
mcp_io_github_chr_lighthouse_audit
  categories: ["accessibility", "best-practices", "performance"]
```

## What to Look For

### Visual Issues

- Z-fighting (flickering surfaces at similar depths)
- Missing or stretched textures
- HUD elements overlapping or off-screen
- Creature animations glitching
- Lighting inconsistencies (too dark to see, or washed out)
- Particles rendering behind geometry

### Interaction Issues

- Controls not responding
- Camera clipping through terrain
- Player getting stuck on geometry
- No feedback on player actions (damage, pickup)
- Menu not working or not closeable

### Performance Issues

- FPS drops below 30
- Stutter when creatures spawn
- Growing memory usage over time (dispose missing)
- Long frame times during scene transitions

### Accessibility Issues

- No keyboard controls for menus
- Low contrast text on HUD
- Missing focus indicators
- No screen reader support for critical information

## Dispatching Workers for Fixes

Use `runSubagent` with `agentName: "Local Worker"`. Each issue gets its own worktree.

Before dispatching, create the worktree:

```bash
cd F:\repos\deep-underworld
git worktree add -b agent/ux-fix-<N> F:\repos\deep-underworld-ux-fix-<N> main
```

Then dispatch with a prompt that includes:

1. Worktree path and branch name
2. Task description with `[UX Fix]` prefix
3. Evidence (screenshot description or console error text)
4. Affected file path
5. Suggested fix

After all workers complete, request a Reviewer for each PR.
