# Copilot Instructions — deep-underworld

## Repository Facts

- **Repository**: `pwretmo/deep-underworld`
- **Owner**: `pwretmo`
- **Origin**: `https://github.com/pwretmo/deep-underworld`
- **Default branch**: `main`
- **Local path** (VS Code only): `F:\repos\deep-underworld`
- **Game Test URL (headless)**: `http://localhost:5173?autoplay` — always use for automated testing
- **Game Test URL (manual)**: `http://localhost:5173` — use for interactive play-testing

When any agent or skill needs the repo owner, name, or URL — use the values above.
Never prompt the user for repository identity information.

## Project Overview

This is a Three.js deep-ocean exploration horror game built with Vite.

- **Language**: JavaScript (ES modules)
- **Build**: `npm run build` (Vite)
- **Dev server**: `npm run dev`
- **No test framework yet** — validate changes by running `npm run build` successfully.

## Completion Contract

These rules are **mandatory** for every agent role in this repository, including the main conversation orchestrator when operating on this repo.

An agent turn is **not complete** until all of the following are true:

1. The requested work is actually finished, or the agent is genuinely blocked and has reported the blocker
2. The agent has sent a brief plain-language summary of what was accomplished
3. The agent has immediately called `task_complete`

Additional required behavior:

- **Never** end a successful turn with only a normal chat response. A completion summary must be followed by `task_complete` in the same turn.
- **Never** treat a question-only answer as exempt. If the user asked for information and the answer has been fully provided, the agent must still call `task_complete`.
- **Never** call `task_complete` while work remains, while a tool error is unresolved, or while the agent still has open questions it can answer itself.
- If a completion hook or reminder says `task_complete` was missed, treat that as a real failure and correct it immediately rather than restating the prior answer.

## Engineering Quality Standards

These rules are **mandatory** for every agent role — workers, reviewers, UX testers, the orchestrator, and cloud agents. No agent may override, weaken, or work around them.

### Proper Fixes Only — Never Remove Features to Fix Bugs

**If a feature has a bug, fix the bug — do not remove the feature.**

This is the single most important engineering rule in this repository. Removing, disabling, or downgrading a feature to eliminate a side-effect is **never acceptable**. The fix must address the root cause while preserving all existing functionality.

Examples of **prohibited** shortcuts:

| Problem                                   | Prohibited shortcut  | Required approach                                  |
| ----------------------------------------- | -------------------- | -------------------------------------------------- |
| Shadow map causes GPU stall on first use  | Remove `castShadow`  | Pre-allocate the shadow map at init time           |
| A creature's AI causes frame drops        | Disable the creature | Optimize the AI (LOD, spatial culling, throttling) |
| Post-processing effect glitches on resize | Remove the effect    | Fix the resize handler to re-initialize properly   |
| Audio causes errors on mobile             | Skip audio loading   | Add proper feature detection and graceful fallback |
| Physics causes collision bugs             | Remove physics       | Fix the collision detection logic                  |

### Root-Cause Analysis Required

Every bug fix must identify and address the **root cause**, not symptoms. Before implementing a fix, the worker must:

1. **Diagnose** — understand _why_ the bug occurs, not just _what_ happens
2. **Preserve** — confirm the fix keeps all existing features and behavior intact
3. **Verify** — ensure the fix resolves the root cause, not just the visible symptom

If a proper fix is complex, break it into incremental steps — but the end state must preserve 100% of existing functionality. A partial improvement that moves toward the proper fix is acceptable; a shortcut that removes functionality is not.

### Applying These Rules by Role

- **Workers** (local and cloud): Must follow these rules when implementing any change. If a task description or suggested fix implies removing a feature, the worker must propose a proper alternative instead.
- **Reviewers**: Must reject any PR that removes, disables, or downgrades functionality to fix a bug. This is a **blocking** review issue — it cannot be waived.
- **UX Testers**: Suggested fixes in issue reports must comply with these rules. Never suggest removing a feature as a fix.
- **Orchestrator**: When re-dispatching a worker with review comments, reinforce these rules if the rejected fix involved a feature removal.

### Browser Hygiene — Mandatory

These rules are **mandatory** for every agent role and the orchestrator. Violations drain system resources, degrade game performance, and make testing unreliable.

1. **One browser page at a time.** Never have more than one game page open simultaneously. Do not open the game in both an external browser (Edge, Chrome) and the VS Code Simple Browser. Before opening a new page, check for and close any existing game pages.
2. **`npm run dev` may auto-open a browser tab.** If Vite opens a tab automatically and you intend to use a different browser page (e.g., via browser automation tools), close the auto-opened tab immediately.
3. **Close every page you open.** Any browser page or tab opened during a session must be closed before calling `task_complete`, including on abort and error exits. Keep a running list of opened pages and close all of them at the end.
4. **Reuse, don't duplicate.** If a game page is already open, reload or re-navigate it instead of opening a second one. Only open a fresh page if no existing page can be reused.
5. **Probe pages are temporary.** If you open `about:blank` or any temporary page for a liveness check, close it immediately after the check.
6. **Prove Chrome provenance before reuse.** A page shown in session context or a `Browser Pages` attachment is not automatically trustworthy. Reuse an existing game page only if the current run has already validated a Chrome-backed opener/read path and the page was opened by, or rediscovered from, that same Chrome tool family. Otherwise, ignore it and open a fresh Chrome page.
7. **Use the declared Chrome MCP server for UX testing.** This repo declares `io.github.ChromeDevTools/chrome-devtools-mcp` in `.vscode/mcp.json`. For UX or gameplay testing, use host-exposed tools backed by that server that map to canonical `chrome-devtools-mcp` operations such as `new_page`, `take_snapshot`, `list_pages`, `navigate_page`, `press_key`, `evaluate_script`, `list_console_messages`, `take_screenshot`, `performance_start_trace`, and `take_memory_snapshot`. Do not fall back to `open_browser_page`.

#### Applying Browser Hygiene by Role

- **Orchestrator**: Before starting `npm run dev`, check for existing browser pages. If Vite auto-opens a tab, close it if browser automation tools will be used instead. Never open the game URL manually AND via automation.
- **Orchestrator**: Before starting `npm run dev`, check for existing browser pages. If Vite auto-opens a tab, close it if browser automation tools will be used instead. Never open the game URL manually AND via automation. Do not treat an inherited page attachment as proof that Chrome is already in use; verify Chrome liveness first. For this repo's UX testing, require the `io.github.ChromeDevTools/chrome-devtools-mcp` tool family and abort if it is not available.
- **UX Testers**: Follow the Browser Session Hygiene section in the ux-testing skill. Maintain exactly one gameplay page. Close all pages before `task_complete`.
- **Workers / Reviewers / Mergers**: If you need to open the game for any reason (e.g., visual verification), use one page, close it when done.

## Agent Workflow Conventions

### Branch Naming

| Origin                       | Prefix     | Example                     |
| ---------------------------- | ---------- | --------------------------- |
| Local worker agent           | `agent/`   | `agent/add-bioluminescence` |
| GitHub cloud agent (Copilot) | `copilot/` | `copilot/fix-123`           |

### Worktree Isolation (Local Agents)

Local subagents **must** work in a dedicated git worktree, never directly on `main`.
Worktrees are created at `F:\repos\deep-underworld-worktrees\<slug>` where `<slug>` matches the branch suffix.

Before a Local Worker edits files or runs build/git commands, it must verify all of the following and abort if any check fails:

1. Current directory exactly matches the assigned worktree path
2. Current branch exactly matches the assigned `agent/<slug>` branch
3. Current branch is not `main`
4. Current directory is not `F:\repos\deep-underworld`

This is a hard-stop preflight, not a guideline. If the preflight fails, the worker must report the violation and do no further work.

Cloud agents do not use worktrees — they work directly on their `copilot/` branch.

### GitHub Operations (Local Agents)

Local agents **must** use the GitHub MCP server tools (`mcp_io_github_git_*`) for all GitHub operations:

- Creating branches, PRs, reading files, searching code, merging PRs, etc.
- **Never** use the `gh` CLI locally unless the workflow explicitly requires it. Review-thread resolution is the standing exception: when a review thread needs to be resolved, use the `gh api graphql` procedure in `.github/skills/review-thread-resolution/SKILL.md` as the first option before any fallback reply path.
- The MCP tools use the parameters `owner: "pwretmo"` and `repo: "deep-underworld"`.

GitHub cloud agents (Copilot coding agent) use their built-in GitHub API access instead.

### GitHub Review Thread Follow-Up

GitHub review-thread state is part of merge readiness in this repository.

- Preferred policy: when blocking review feedback has been addressed, resolve the review thread.
- Use `.github/skills/review-thread-resolution/SKILL.md` and its `gh api graphql` path as the first option for resolving the thread.
- If `gh api graphql` cannot resolve the thread, use the skill's in-thread reply fallback.
- If thread resolution is not possible, open blocking review conversations are acceptable if the underlying fix is verified and a reply has been posted in the thread.
- Do not depend on browser automation for merge-critical thread handling.
- The workflow for this lives in `.github/skills/review-thread-resolution/SKILL.md`.
- Before approving or merging, re-poll reviews and review comments to confirm the feedback is addressed and that the thread has either been resolved or acknowledged with an in-thread reply.

### PR Lifecycle

1. **Worker** creates a branch, implements changes, pushes, and opens a PR.
2. **Reviewer** reviews the PR, leaves comments, requests changes if needed.
3. **Worker** fixes issues found in review (in its worktree).
4. **Reviewer** re-reviews until approved.
5. **Merger** merges approved PRs into `main` one at a time, verifies build, cleans up worktrees.

### Labels

- `agent-work` — PR was created by a local worker agent
- `agent-reviewed` — PR has passed agent review
- `agent-approved` — PR is approved and ready to merge

### Commit Messages

Use conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`.

### Cloud Agent Guidelines

GitHub cloud agents (Copilot coding agent) follow these rules:

- Use the `copilot/` branch prefix (see Branch Naming above).
- Use built-in GitHub API access — not MCP tools or `gh` CLI.
- Follow the same labels, commit conventions, and PR lifecycle as local agents.
- Validate changes with `npm run build`.
- Ignore worktree paths and local filesystem references in this file.

## Agent Roles

Four agent roles are defined in `.github/agents/`:

| Agent            | File                    | Purpose                                                           |
| ---------------- | ----------------------- | ----------------------------------------------------------------- |
| **Local Worker** | `local-worker.agent.md` | Implements changes in a worktree, pushes, creates PR              |
| **Reviewer**     | `reviewer.agent.md`     | Expert code reviewer — reads diffs, posts reviews, manages labels |
| **Merger**       | `merger.agent.md`       | Squash-merges approved PRs, verifies build, cleans up             |
| **UX Tester**    | `ux-tester.agent.md`    | Plays the game in a browser, finds UX issues, dispatches workers  |

Supporting skills in `.github/skills/`:

| Skill                    | Folder                      | Purpose                                                                                                     |
| ------------------------ | --------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Worktree Workflow        | `worktree-workflow/`        | How to create, use, and clean up worktrees + push via git/MCP                                               |
| Review Workflow          | `review-workflow/`          | How to read PR diffs, post reviews, and manage labels via MCP                                               |
| Review Thread Resolution | `review-thread-resolution/` | How to verify addressed review feedback, resolve threads when possible, and fall back to an in-thread reply |
| Merge Workflow           | `merge-workflow/`           | How to find approved PRs, squash-merge, verify, and clean up                                                |
| UX Testing               | `ux-testing/`               | How to play-test the game in a browser and dispatch fixes                                                   |

## Orchestrator Patterns (Local VS Code Only)

These dispatch templates are for the local VS Code orchestrator. Cloud agents should ignore this section.

### Orchestrator Compliance

Before dispatching a subagent for any skill-governed workflow, the orchestrator must read the referenced skill file in the main thread first. Dispatching a named agent without first loading its required skill is a workflow violation.

The dispatch prompt must restate the non-negotiable parts of the workflow when the skill defines hard-stop or blocking behavior. For UX testing, that includes browser-tool liveness checks, `?autoplay` for automated runs, browser-only evidence gathering, and the full Local Worker -> Reviewer -> Merger lifecycle for fixes.

If this repository defines an explicit agent workflow for a task, do not substitute alternate PR or review flows just because another path is available in the tool environment. Follow the repository workflow unless the user explicitly asks to override it.

The main conversation agent acts as orchestrator. Example dispatch prompts:

### Dispatch a Local Worker

```
You are a Local Worker agent for the deep-underworld repo (owner: pwretmo, repo: deep-underworld).
Your worktree is at: F:\repos\deep-underworld-worktrees\<slug>
Your branch is: agent/<slug>

TASK: <description>
ISSUE: #<number> (omit if not implementing a specific issue)

Follow the worktree-workflow skill in .github/skills/worktree-workflow/SKILL.md.
Non-negotiables:
- Run the worktree preflight before any edit, build, or git command. Abort on any path or branch mismatch.
- Never work on `main` or outside the assigned worktree.
- Never remove, disable, or downgrade a feature to fix a bug; preserve functionality and fix the root cause.
- If ISSUE is provided, include "Fixes #<number>" in the PR body and fully implement that issue.

For new work: create the PR targeting `main` and ensure the `agent-work` label is present.
For review-fix work: update the existing branch only and do not create a new PR.
Return a short summary with PR status, then call task_complete.
```

### Dispatch a Reviewer

```
You are a Reviewer agent for the deep-underworld repo (owner: pwretmo, repo: deep-underworld).
Review PR #<number>.

Follow the review-workflow skill in .github/skills/review-workflow/SKILL.md.
Use the review-thread-resolution skill in .github/skills/review-thread-resolution/SKILL.md if fixed review conversations still need to be resolved or acknowledged before approval. When thread resolution is needed, use `gh api graphql` first and only fall back to an in-thread reply if that fails.

Blocking rules:
1. Reject any PR that removes, disables, or downgrades existing functionality to fix a bug.
2. If the PR references a GitHub issue, verify that all requirements from that issue are implemented.
3. Treat external Copilot review comments and threads as blocking until verified fixed.
4. Do not add `agent-approved` until blocking review conversations are resolved or acknowledged in-thread per the skill.

Post the review, reconcile labels with read-merge-write, return `REVIEW RESULT: REQUEST_CHANGES`, `REVIEW RESULT: APPROVED`, or `REVIEW RESULT: BLOCKED`, then call task_complete.
If GitHub blocks formal review actions on a self-authored PR, still return the correct review result and withhold `agent-approved` while blockers remain.
```

### Re-dispatch Worker with Review Fixes

Before dispatching, verify the worktree still exists and recreate if missing:

```powershell
git worktree list
# If missing, recreate from the remote branch (NOT origin/main — that discards PR commits):
git fetch origin agent/<slug>
git worktree add F:\repos\deep-underworld-worktrees\<slug> agent/<slug>
```

```
You are a Local Worker agent for the deep-underworld repo (owner: pwretmo, repo: deep-underworld).
Your worktree is at: F:\repos\deep-underworld-worktrees\<slug>
Your branch is: agent/<slug>
PR number: #<number>

FIX THESE REVIEW ISSUES:
<paste review comments here>

Follow the worktree-workflow skill in .github/skills/worktree-workflow/SKILL.md.
Non-negotiables:
- Run the worktree preflight before any edit, build, or git command. Abort on any mismatch.
- Never work on `main` or outside the assigned worktree.
- Never remove, disable, or downgrade a feature to fix a bug. Restore and preserve functionality while fixing the root cause.

Fix the issues, validate with `npm run build`, update the existing branch only, return a short summary, and call task_complete.
```

### Dispatch the Merger

```
You are a Merger agent for the deep-underworld repo (owner: pwretmo, repo: deep-underworld).

Follow the merge-workflow skill in .github/skills/merge-workflow/SKILL.md.
Use .github/skills/review-thread-resolution/SKILL.md if already-addressed blocking review conversations are still open. When thread resolution is needed, use `gh api graphql` first and only fall back to an in-thread reply if that fails.

Non-negotiables:
- Merge only PRs labeled `agent-approved`.
- Re-poll review state before each merge and stop on any unaddressed blocker or outstanding `REQUEST_CHANGES`.
- Squash-merge one PR at a time.
- After each merge, pull `main`, run `npm run build`, and stop on the first failure.
- Clean up worktrees only for merged local `agent/` branches.

Return `MERGE RESULTS`, then call task_complete.
```

### Dispatch a UX Tester

```
Before dispatching this agent, read .github/skills/ux-testing/SKILL.md in the main thread. Do not skip this step.

You are a UX Tester agent for the deep-underworld repo (owner: pwretmo, repo: deep-underworld).

Read these skills before testing:
- .github/skills/ux-testing/SKILL.md
- .github/skills/worktree-workflow/SKILL.md
- .github/skills/review-workflow/SKILL.md
- .github/skills/merge-workflow/SKILL.md

Non-negotiables:
1. Start with the browser-tool discovery and about:blank liveness check from the ux-testing skill.
2. Use `http://localhost:5173?autoplay` for automated UX testing.
3. Use browser-only evidence gathering.
4. Enforce browser hygiene exactly as defined in the ux-testing skill and Browser Hygiene in copilot-instructions.md.
5. For every issue found, use the Local Worker -> Reviewer -> Merger lifecycle. Do not edit source directly or substitute alternate PR flows.
6. Suggested fixes must preserve functionality and target the root cause.
7. Continue through review, merge, and re-test unless blocked by a required hard-stop condition from the skills.

Focus area (optional): <area or "full sweep">

Return a structured UX test report with issues found, PRs created, and verification results, then call task_complete.
```

## Parallelization Rules

These rules apply to the orchestrator and any agent that dispatches sub-work.

### Safe to parallelize (independent read/write targets)

- **`runSubagent` (independent tasks)** — parallel subagent execution is supported (since VS Code January 2026). Dispatch multiple workers or reviewers in parallel when they operate on **separate worktrees/branches** and have no data dependencies. Example: dispatching 3 Local Workers that each fix a different issue in their own worktree.
- **MCP read calls across different PRs** — e.g. `get_reviews` and `get_review_comments` for PR #10, #11, #12 can all fire in one batch.
- **MCP read calls within the same PR** — `get_reviews` and `get_review_comments` for the same PR are independent reads; call both at once.
- **Label writes on different PRs** — each `issue_write` targets a different issue number.

### Must stay sequential

- **`runSubagent` (dependent tasks)** — when one subagent's output feeds into the next (e.g. worker → reviewer for the same PR), keep them sequential.
- **`run_in_terminal`** — shares a single shell session. Run one command, wait for output, then next.
- **Git worktree creation** — `git worktree add` modifies shared `.git/worktrees` state. Create them one at a time. Batch all creations _before_ dispatching parallel workers.
- **Merges** — must be sequential with a build-verify step between each.

### Orchestrator patterns for parallel polling

When multiple PRs need external review polling, poll the entire batch at once instead of waiting ~2 minutes per PR:

```
# One parallel batch — all independent reads:
mcp_io_github_git_pull_request_read  pullNumber: 10  method: "get_reviews"
mcp_io_github_git_pull_request_read  pullNumber: 10  method: "get_review_comments"
mcp_io_github_git_pull_request_read  pullNumber: 11  method: "get_reviews"
mcp_io_github_git_pull_request_read  pullNumber: 11  method: "get_review_comments"
```

After collecting results, group PRs by state (needs-fixes / ready-for-review / already-approved) and process each group in order.
