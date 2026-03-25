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

### ⚠️ Chrome Required — VS Code Simple Browser is Forbidden

**Never use the VS Code Simple Browser (the built-in VS Code panel browser) for UX testing.** It runs inside Electron's embedded webview without GPU hardware acceleration, causing Three.js to fall back to software rendering. This produces misleading visual and performance results — frame rates, lighting, shader output, and WebGL behavior will not match what a real user sees.

All UX testing **must** use a real Chrome instance via the Chrome DevTools MCP tools (`mcp_io_github_chr_*`) or the `open_browser_page` tool that targets an external Chrome process. If only the VS Code Simple Browser is available, **STOP immediately** with the abort message below.

Do **not** assume an already-open page listed in a `Browser Pages` attachment is Chrome-backed. That attachment only tells you a page exists; it does not prove which browser opened it. Treat every pre-existing page as **untrusted** until one of these is true in the current run:

- you opened it yourself with `open_browser_page` or a Chrome DevTools MCP page-open tool, or
- you completed the required Chrome liveness check and then reused a page discovered from the same Chrome tool family.

If you cannot prove a page is Chrome-backed, do not use it for gameplay evidence, screenshots, performance traces, or console analysis.

Acceptable open-page tools (Chrome only):

- `open_browser_page`
- `mcp_io_github_chr_new_page`

Acceptable page-state tools:

- `read_page`
- `mcp_io_github_chr_take_snapshot`

If none of the valid open/read combinations are available, **STOP immediately** — output the following and call `task_complete`:

> **UX TEST ABORTED — Browser tooling unavailable.**
> Required page open/read capabilities are unavailable in this session.
> Enable browser automation tools in VS Code and retry.

Do NOT fall back to code-based analysis, file searching, or any substitute for live browser testing.

Once ready, do a liveness check by opening `about:blank` and reading a snapshot:

- `open_browser_page` + `read_page`, or
- `mcp_io_github_chr_new_page` + `mcp_io_github_chr_take_snapshot`

After a successful liveness check, close the temporary `about:blank` page immediately. Do not keep probe tabs open for the rest of the session.

The liveness check is also your provenance check: only after it succeeds may you reuse an existing gameplay page that is discoverable from the same Chrome-backed tool family. If the only visible gameplay page comes from a generic attachment and was not opened or verified through that Chrome path in the current run, ignore it and open a fresh Chrome page instead.

If this fails or times out, **STOP immediately** with the same abort message above.

## Starting the Dev Server

Run in a background terminal:

```bash
cd F:\repos\deep-underworld
npm run dev
```

**Important**: Vite may auto-open a browser tab when starting the dev server. If you intend to use browser automation tools (e.g., `open_browser_page`, `mcp_io_github_chr_new_page`) to open the game, you must close the auto-opened tab immediately — do not leave it running alongside the automation page. Check for new pages right after `npm run dev` starts and close any that are not your automation page.

Wait ~3 seconds, then open the game.

## Browser Session Hygiene

**These rules are mandatory — not guidelines. Violations drain system resources, degrade game performance, and produce unreliable test results.**

- **One gameplay page, period.** Keep exactly one gameplay page open for `http://localhost:5173?autoplay` during a UX run. Never have two game pages open at the same time — not in the same browser, not across browsers, not in VS Code Simple Browser alongside an external browser.
- Before opening a new game page, inspect existing pages/tabs (use `mcp_io_github_chr_list_pages` or equivalent) and reuse an existing autoplay page only if its Chrome provenance is known from the current run.
- Treat the first gameplay page you open as the primary page for the whole run. Reuse that page ID/tab for screenshots, console checks, audits, and re-tests.
- If a gameplay page was inherited from session state and you did not prove it is Chrome-backed, do not count it as the primary page. Open a fresh Chrome gameplay page and use that instead.
- **Close auto-opened tabs.** If `npm run dev` auto-opens a browser tab and you are using a different page for automation, close the auto-opened tab immediately.
- If you must open a temporary second page for a probe or isolated check, close it immediately after that step completes.
- After restarting the dev server or re-testing fixes, reload or re-navigate the existing gameplay page instead of opening a fresh tab.
- **Track and close all pages.** Keep a running list of every page/tab you opened during the session. Close ALL of them before calling `task_complete`, including on abort and error exits. No orphaned tabs.

## Browser Interaction Patterns

Prefer high-level browser tools (`open_browser_page`, `read_page`, `click_element`, `type_in_page`, `screenshot_page`) and Chrome MCP tools when available.

### Opening the game

- Preferred: reuse an existing autoplay page only after proving it belongs to the same Chrome-backed tool family you validated in Phase 0; otherwise call `open_browser_page` once with `http://localhost:5173?autoplay`
- Alternate: reuse an existing autoplay tab only after proving it belongs to the same Chrome-backed tool family you validated in Phase 0; otherwise call `mcp_io_github_chr_new_page` once with `http://localhost:5173?autoplay`

Always use `?autoplay` for automated UX testing.

### Taking a screenshot

- Preferred: `screenshot_page`
- Alternate: `mcp_io_github_chr_take_snapshot` (text/a11y snapshot)

### Reading console errors

```javascript
async (page) => {
  const logs = [];
  page.on("console", (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
  page.on("pageerror", (err) => logs.push(`[ERROR] ${err.message}`));

  // Keep page open and let errors accumulate for ~2 seconds
  await page.waitForTimeout(2000);

  return logs.join("\n");
};
```

### Playing the game

- Preferred: `type_in_page` with key presses (WASD, arrows, Escape)
- Alternate: `mcp_io_github_chr_press_key`

### Clicking the canvas (if not autoplay)

```javascript
async (page) => {
  const canvas = (await page.$("#game-canvas")) || (await page.$("canvas"));
  if (canvas) {
    await canvas.click();
    await page.waitForTimeout(500);
    return "Canvas clicked (pointer lock acquired)";
  }
  return "Canvas not found";
};
```

### Lighthouse performance audit

Use the built-in `lighthouse-mcp` tool (if available) or run via npx:

```bash
npx lighthouse http://localhost:5173?autoplay --view
```

# Open menu

mcp_io_github_chr_press_key key: "Escape"

```

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

```

mcp_io_github_chr_evaluate_script
expression: "(() => {
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
gameOver: game.gameOver
};
})()"

```

> **Tip**: If `window.game` isn't responding, check that the page has
> finished loading. In autoplay mode the game starts immediately.

### Checking console errors

The game logs state changes with a `[deep-underworld]` prefix. Filter for these to track game events (start, game over, depth zone changes), and filter for errors/warnings to catch runtime issues.

```

mcp_io_github_chr_list_console_messages

```

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

````

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
````

### Dispatch workers

Subagent calls are blocking, so dispatch workers one at a time. Include in each prompt:

1. Worktree path and branch name
2. Task description with `[UX Fix]` prefix
3. Evidence (screenshot description or console error text)
4. Affected file path
5. Suggested fix

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

Cleanup is mandatory on every exit path. When testing is complete, or if you abort early because tooling/server setup fails, close all browser tabs and windows opened during the session:

```javascript
// Close the current page
async (page) => {
  await page.close();
  return "Browser page closed";
};
```

Or close the entire browser context if multiple tabs were opened for different test phases:

```javascript
// Close browser context (all tabs/windows)
async (page) => {
  const browser = page.context().browser();
  await browser.close();
  return "Browser closed";
};
```

This cleanup ensures Chrome DevTools MCP doesn't leave orphaned browser processes. Always perform cleanup before final `task_complete` call.
