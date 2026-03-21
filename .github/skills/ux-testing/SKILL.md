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

### Create all worktrees upfront

Batch-create every worktree before dispatching any worker. This avoids interleaving slow agent runs with fast git operations:

```bash
cd F:\repos\deep-underworld
git fetch origin main
git worktree add -b agent/ux-fix-1 F:\repos\deep-underworld-ux-fix-1 origin/main
git worktree add -b agent/ux-fix-2 F:\repos\deep-underworld-ux-fix-2 origin/main
# ... one command per issue, run sequentially (shares .git state)
```

### Dispatch workers

Subagent calls are blocking, so dispatch workers one at a time. Include in each prompt:

1. Worktree path and branch name
2. Task description with `[UX Fix]` prefix
3. Evidence (screenshot description or console error text)
4. Affected file path
5. Suggested fix

Fix ALL issues — not just major ones. Minor polish matters for UX quality.

## Reviewing PRs

GitHub is configured with an **external Copilot reviewer** that automatically reviews every PR. The orchestrator must account for both external and local reviews.

### Polling for External Reviews

After workers create or update PRs, poll for external reviews. **Poll ALL PRs in parallel** — fire `get_reviews` and `get_review_comments` for every PR in one tool-call batch:

```
# Parallel batch — all calls are independent reads:
mcp_io_github_git_pull_request_read  pullNumber: <PR-A>  method: "get_reviews"
mcp_io_github_git_pull_request_read  pullNumber: <PR-A>  method: "get_review_comments"
mcp_io_github_git_pull_request_read  pullNumber: <PR-B>  method: "get_reviews"
mcp_io_github_git_pull_request_read  pullNumber: <PR-B>  method: "get_review_comments"
# ... one pair per PR
```

If external reviews haven't appeared yet, wait ~30 seconds and poll the full batch again. Repeat up to ~2 minutes total (not per PR).

#### Grouping by review state

After polling, sort PRs into:

- **Needs external fixes** — external reviewer requested changes → re-dispatch workers first
- **Ready for local review** — external approved or absent → dispatch local Reviewer
- **Already approved** — skip review

Process "needs external fixes" first (unblocks re-review), then "ready for local review".

After a batch of fix pushes, re-poll ALL affected PRs in parallel before dispatching the next review round.

### Handling External Review Feedback

- If the external reviewer **requests changes**, extract the comments and re-dispatch the Local Worker to fix them — don't dispatch the local Reviewer yet.
- If the external reviewer **approves** (or doesn't appear), dispatch the local Reviewer as normal.
- After any fix push, poll again — the push may trigger a new external review round.

### Dispatching the Local Reviewer

```
runSubagent  agentName: "Reviewer"
  prompt: "You are a Reviewer agent for the deep-underworld repo (owner: pwretmo, repo: deep-underworld).
  Review PR #<number>.
  Follow the review-workflow skill in .github/skills/review-workflow/SKILL.md.
  ..."
```

If either the external review or local Reviewer requests changes, re-dispatch the worker with the combined feedback, then re-review. Max 3 rounds per PR.

A PR is ready for merge only when it has **no outstanding `REQUEST_CHANGES` reviews** from any source.

## Merging Approved PRs

After PRs are approved (`agent-approved` label), dispatch the Merger:

```
runSubagent  agentName: "Merger"
  prompt: "You are a Merger agent for the deep-underworld repo (owner: pwretmo, repo: deep-underworld).
  Follow the merge-workflow skill in .github/skills/merge-workflow/SKILL.md.
  Find all open PRs labeled 'agent-approved' and squash-merge them one at a time.
  After each merge, pull main locally and run npm run build to verify.
  Clean up worktrees for any merged local branches."
```

If a merge causes a build failure, stop and report — do not continue merging.

## Post-Merge Verification

After merges are done:

1. Kill and restart the dev server: `npm run dev`
2. Reload the game in the browser
3. Re-test the specific areas where fixes were applied
4. Confirm each fix is working and note any regressions
