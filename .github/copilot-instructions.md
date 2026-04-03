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

### Error Messages Are Symptoms — Never Treat Them as Diagnoses

**An error message tells you _what_ failed, not _why_.**

Before proposing any fix, the agent must ask: **"Does this error make physical sense given the known hardware, configuration, and codebase?"** If the answer is no, the error is a downstream symptom of a deeper code bug — not a hardware or platform limitation.

Examples of **prohibited** reasoning:

| Error message                        | Hardware context      | Prohibited conclusion                     | Required approach                                                    |
| ------------------------------------ | --------------------- | ----------------------------------------- | -------------------------------------------------------------------- |
| `E_OUTOFMEMORY` creating pipeline   | RTX 4090 (24 GB VRAM) | "GPU can't handle it, fall back to WebGL" | Investigate why 1100+ pipelines are created — fix the pipeline explosion |
| `WebGPU Device Lost`                 | Modern discrete GPU   | "WebGPU is unstable, use WebGL"           | Find what caused the device loss (resource leak, API misuse)         |
| `Out of memory` on texture upload    | 16 GB RAM             | "Reduce texture resolution"               | Find the leak or duplication causing excessive memory use            |
| `Maximum call stack size exceeded`   | Any                   | "Increase stack size"                     | Fix the infinite recursion or unbounded recursion depth              |

### No Implementation Before Diagnosis

**No agent may write, edit, or propose code changes until root-cause analysis is complete.**

A bad diagnosis that stays verbal is recoverable. A bad diagnosis turned into code creates regressions that compound the damage. The workflow is:

1. **Investigate** — gather evidence (logs, code paths, profiling, hardware specs)
2. **Diagnose** — state the root cause explicitly and explain why it makes sense given the evidence
3. **Propose** — describe the fix approach to the user
4. **Wait** — do not implement until the user confirms the approach (or the agent is operating in a dispatch where the diagnosis has already been validated)
5. **Implement** — only after steps 1–4 are complete

### Browser Hygiene — Mandatory

These rules are **mandatory** for every agent role and the orchestrator. Violations drain system resources, degrade game performance, and make testing unreliable.

1. **One browser page at a time.** Never have more than one game page open simultaneously. Do not open the game in both an external browser (Edge, Chrome) and the VS Code Simple Browser. Before opening a new page, check for and close any existing game pages.
2. **`npm run dev` may auto-open a browser tab.** If Vite opens a tab automatically and you intend to use a different browser page (e.g., via browser automation tools), close the auto-opened tab immediately.
3. **Close every page you open.** Any browser page or tab opened during a session must be closed before calling `task_complete`, including on abort and error exits. Keep a running list of opened pages and close all of them at the end.
4. **Reuse, don't duplicate.** If a game page is already open, reload or re-navigate it instead of opening a second one. Only open a fresh page if no existing page can be reused.
5. **Probe pages are temporary.** If you open `about:blank` or any temporary page for a liveness check, close it immediately after the check.
6. **Prove Chrome provenance before reuse.** A page shown in session context or a `Browser Pages` attachment is not automatically trustworthy. Reuse an existing game page only if the current run has already validated a Chrome-backed opener/read path and the page was opened by, or rediscovered from, that same Chrome tool family. Otherwise, ignore it and open a fresh Chrome page.
7. **Use the declared Chrome MCP server for UX testing.** This repo declares `io.github.ChromeDevTools/chrome-devtools-mcp` in `.vscode/mcp.json`. For UX or gameplay testing, use host-exposed tools backed by that server that map to canonical `chrome-devtools-mcp` operations such as `new_page`, `take_snapshot`, `list_pages`, `navigate_page`, `press_key`, `evaluate_script`, `list_console_messages`, `take_screenshot`, `performance_start_trace`, and `take_memory_snapshot`. Do not fall back to `open_browser_page`.

All roles must follow browser hygiene. The orchestrator must verify Chrome liveness before reuse and require the `io.github.ChromeDevTools/chrome-devtools-mcp` tool family for UX testing.

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

### Issue Review Lifecycle

1. **Issue Reviewer** reads the target issue, its comments, and all reachable sub-issues.
2. Unless the user explicitly says otherwise, assume a coding agent will implement the reviewed issue after this workflow completes.
3. If the topic is advanced or complex, the Issue Reviewer researches high-quality external sources and cites them in the issue updates.
4. The Issue Reviewer runs the issue through three lenses in order: **software architect** -> **software engineer** -> **technical writer**.
5. The Issue Reviewer updates issue bodies/comments, creates or reprioritizes sub-issues, and handles safe duplicate consolidation as needed.
6. If those changes reveal new findings, the Issue Reviewer re-reads the affected issue tree and repeats the full pass.
7. The workflow completes only when a full architect -> engineer -> technical writer pass produces no new findings and the issue is explicit enough for a coding agent to implement without inventing missing requirements, or a real blocker is reported.

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

Five agent roles are defined in `.github/agents/`: Local Worker, Reviewer, Issue Reviewer, Merger, UX Tester. Supporting skills live in `.github/skills/`. See the agent and skill files for details.

## Orchestrator Patterns & Dispatch Templates

Dispatch templates, ship-it interpretation, parallelization rules, and orchestrator compliance requirements live in `.github/skills/orchestrator-dispatch/SKILL.md`. The orchestrator **must** load that skill before dispatching any subagent.
