---
name: ux-testing
description: "Browser-based UX testing for Three.js games using Chrome DevTools MCP — screenshots, keyboard input, console monitoring, performance tracing, memory analysis, Lighthouse audits, and dispatching fix workers. Always use ?autoplay query parameter for headless testing."
---

# UX Testing Skill

⚠️ **CRITICAL: Always use `?autoplay` query parameter when testing automatically.**

- **Autoplay URL**: `http://localhost:5173?autoplay`
- **Effect**: Skips menu, starts game immediately, disables pointer lock (required for browser automation)
- **Manual testing**: Use `http://localhost:5173` and click "Begin Descent" manually

How to play-test the deep-underworld game in a browser, find UX issues, and dispatch fixes.

## Tool Discovery (Required First Step)

Browser tooling may differ by session. Before any browser interaction, verify that you can both open a page and read page state.

### ⚠️ Chrome DevTools MCP Required — VS Code Simple Browser is Forbidden

**Never use the VS Code Simple Browser (the built-in VS Code panel browser) for UX testing.** It runs inside Electron's embedded webview without GPU hardware acceleration, causing Three.js to fall back to software rendering. This produces misleading visual and performance results — frame rates, lighting, shader output, and WebGL behavior will not match what a real user sees.

This repository declares the MCP server `io.github.ChromeDevTools/chrome-devtools-mcp` in `.vscode/mcp.json`. All automated UX testing in this repo **must** use tools backed by that server. The exact tool IDs exposed to the agent are host-specific and may be prefixed or wrapped differently, but they must map to the canonical `chrome-devtools-mcp` operations such as `new_page`, `take_snapshot`, `list_pages`, `navigate_page`, `press_key`, `evaluate_script`, `list_console_messages`, `take_screenshot`, `performance_start_trace`, and `take_memory_snapshot`. `open_browser_page`, `read_page`, and other generic browser-surface tools are not valid substitutes for gameplay evidence in this repository.

If Chrome DevTools MCP page-open/page-read tools are unavailable in the current session, **STOP immediately** with the abort message below. Do not fall back to `open_browser_page`.

Do **not** assume an already-open page listed in a `Browser Pages` attachment is Chrome-backed. That attachment only tells you a page exists; it does not prove which browser opened it. Treat every pre-existing page as **untrusted** until one of these is true in the current run:

- you opened it yourself with a Chrome DevTools MCP page-open tool, or
- you completed the required Chrome liveness check and then reused a page discovered from the same Chrome tool family.

If you cannot prove a page is Chrome-backed, do not use it for gameplay evidence, screenshots, performance traces, or console analysis.

Acceptable open-page tools:

- a host-exposed Chrome DevTools MCP tool that maps to canonical `new_page`

Acceptable page-state tools:

- a host-exposed Chrome DevTools MCP tool that maps to canonical `take_snapshot`

If none of the valid open/read combinations are available, **STOP immediately** — output the following and call `task_complete`:

> **UX TEST ABORTED — Browser tooling unavailable.**
> Required page open/read capabilities are unavailable in this session.
> Enable browser automation tools in VS Code and retry.

Do NOT fall back to code-based analysis, file searching, or any substitute for live browser testing.

Once ready, do a liveness check by opening `about:blank` and reading a snapshot:

- canonical `new_page` + canonical `take_snapshot` (or the equivalent host-exposed tool IDs for those operations)

After a successful liveness check, close the temporary `about:blank` page immediately. Do not keep probe tabs open for the rest of the session.

The liveness check is also your provenance check: only after it succeeds may you reuse an existing gameplay page that is discoverable from the same Chrome-backed tool family. If the only visible gameplay page comes from a generic attachment and was not opened or verified through that Chrome path in the current run, ignore it and open a fresh Chrome page instead.

If this fails or times out, **STOP immediately** with the same abort message above.

## Starting the Dev Server

Run in a background terminal:

```bash
cd F:\repos\deep-underworld
npm run dev
```

**Important**: Vite may auto-open a browser tab when starting the dev server. If you intend to use browser automation tools (the `io.github.ChromeDevTools/chrome-devtools-mcp` tool family) to open the game, you must close the auto-opened tab immediately — do not leave it running alongside the automation page. Check for new pages right after `npm run dev` starts and close any that are not your automation page.

Wait ~3 seconds, then open the game.

## Browser Session Hygiene

**These rules are mandatory — not guidelines. Violations drain system resources, degrade game performance, and produce unreliable test results.**

- **One gameplay page, period.** Keep exactly one gameplay page open for `http://localhost:5173?autoplay` during a UX run. Never have two game pages open at the same time — not in the same browser, not across browsers, not in VS Code Simple Browser alongside an external browser.
- Before opening a new game page, inspect existing pages/tabs (use canonical `list_pages` or an equivalent host-exposed wrapper) and reuse an existing autoplay page only if its Chrome provenance is known from the current run.
- Treat the first gameplay page you open as the primary page for the whole run. Reuse that page ID/tab for screenshots, console checks, audits, and re-tests.
- If a gameplay page was inherited from session state and you did not prove it is Chrome-backed, do not count it as the primary page. Open a fresh Chrome gameplay page and use that instead.
- **Close auto-opened tabs.** If `npm run dev` auto-opens a browser tab and you are using a different page for automation, close the auto-opened tab immediately.
- If you must open a temporary second page for a probe or isolated check, close it immediately after that step completes.
- After restarting the dev server or re-testing fixes, reload or re-navigate the existing gameplay page instead of opening a fresh tab.
- **Track and close all pages.** Keep a running list of every page/tab you opened during the session. Close ALL of them before calling `task_complete`, including on abort and error exits. No orphaned tabs.

## Browser Interaction Patterns

Prefer tools backed by `io.github.ChromeDevTools/chrome-devtools-mcp` for page open/read/control. Use the host-exposed tools that correspond to canonical `chrome-devtools-mcp` operations. Do not use `open_browser_page` for this repository's UX testing workflow.

### Opening the game

- Reuse an existing autoplay tab only after proving it belongs to the same Chrome-backed tool family you validated in Phase 0; otherwise call the host-exposed tool that maps to canonical `new_page` once with `http://localhost:5173?autoplay`

Always use `?autoplay` for automated UX testing.

### Taking a screenshot

- Preferred: canonical `take_screenshot`
- Alternate: canonical `take_snapshot` for a text/a11y snapshot

### Reading console errors

- Use canonical `list_console_messages` to gather page logs after navigation.
- Use canonical `get_console_message` for full detail on an individual message when needed.

### Playing the game

- Preferred: canonical `press_key` for WASD, arrows, Escape, and other gameplay controls.

### Clicking the canvas (if not autoplay)

- Use canonical `take_snapshot` to obtain the canvas element uid.
- Use canonical `click` on that uid, then wait briefly or inspect updated state.

### Lighthouse performance audit

Use the built-in `lighthouse-mcp` tool (if available) or run via npx:

```bash
npx lighthouse http://localhost:5173?autoplay --view
```

### Open menu

Use canonical `press_key` with `Escape`.

### Querying game state via JavaScript

The `Game` instance is exposed on `window.game`. Key properties:

- `game.player.position` — THREE.Vector3
- `game.player.depth` — current depth (positive = deeper)
- `game.depth` — same as above
- `game.fps` — frames per second (updated every ~1 s)
- `game.creatureManager.creatures.length` — number of active creatures
- `game.oxygen` / `game.battery` — resource levels (0-100)
- `game.running` / `game.gameOver` — game state flags
- `game.autoplay` — true when in autoplay mode

```text
Tool: evaluate_script (canonical chrome-devtools-mcp)
Parameters:
  pageId: <current page ID>
  function: () => {
  const game = window.game;
  if (!game) return { error: 'game not found on window' };
  return {
    playerPos: game.player?.position,
    depth: game.depth,
    fps: game.fps,
    creatureCount: game.creatureManager?.creatures?.length,
    oxygen: game.oxygen,
    battery: game.battery,
    running: game.running,
    gameOver: game.gameOver,
  };
}
```

> **Tip**: If `window.game` isn't responding, check that the page has
> finished loading. In autoplay mode the game starts immediately.

### Checking console errors

The game logs state changes with a `[deep-underworld]` prefix. Filter for these to track game events (start, game over, depth zone changes), and filter for errors/warnings to catch runtime issues.

Use canonical `list_console_messages`.

### Performance trace

Use canonical `performance_start_trace`.

Returns Core Web Vitals and performance summary.

### Memory snapshot

Use canonical `take_memory_snapshot`.

### Lighthouse audit

```text
Tool: lighthouse_audit (canonical chrome-devtools-mcp)
Parameters:
  mode: navigation
  device: desktop
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

> **Note**: For performance issues that need architectural changes (e.g., InstancedMesh, code-splitting), dispatch a worker to implement the most impactful incremental improvement — don't skip them just because the full solution is large.

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
git worktree add -b agent/ux-fix-1 F:\repos\deep-underworld-worktrees\ux-fix-1 origin/main
git worktree add -b agent/ux-fix-2 F:\repos\deep-underworld-worktrees\ux-fix-2 origin/main
# ... one command per issue, run sequentially (shares .git state)
```

### Dispatch workers in parallel batches

After all worktrees are created, dispatch Local Worker subagents in parallel for independent issues. Each worker has an isolated worktree and branch, so these calls have no data dependency. Include in each prompt:

1. Worktree path and branch name
2. Task description with `[UX Fix]` prefix
3. Evidence (screenshot description or console error text)
4. Affected file path
5. Suggested fix

Use one parallel batch for the initial issue set, then additional parallel batches for re-dispatched worker fixes that target different worktrees.

Fix ALL issues — critical, major, AND minor. Never defer issues as "known issues" or "lower priority". If an issue requires significant refactoring, break it into the smallest meaningful first step a single worker can implement. Every issue found MUST result in a dispatched worker.

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

> **Worktree reuse**: When re-dispatching a worker for review fixes, the worktree already exists from the initial dispatch. Verify with `git worktree list` before dispatching. If missing (e.g., after a restart), recreate from the remote branch — `git worktree add <path> agent/<slug>` — **not** from `origin/main`, which would lose the PR's commits. See the worktree-workflow skill for the full procedure.

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

## Cleanup: Closing Browser Windows

Cleanup is mandatory on every exit path. When testing is complete, or if you abort early because tooling/server setup fails, close every page you opened during the session.

### Step 1 — List open pages

```
Tool: list_pages (canonical chrome-devtools-mcp)
```

### Step 2 — Close each tracked page

For each page ID in your tracked list:

```
Tool: close_page (canonical chrome-devtools-mcp)
Parameters:
  pageId: <page ID>
```

Call `close_page` once per page opened. After closing all pages, confirm with `list_pages` that no tracked pages remain.

This ensures Chrome DevTools MCP doesn't leave orphaned browser processes. Always perform cleanup before the final `task_complete` call.
