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

#### Applying Browser Hygiene by Role

- **Orchestrator**: Before starting `npm run dev`, check for existing browser pages. If Vite auto-opens a tab, close it if browser automation tools will be used instead. Never open the game URL manually AND via automation.
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
- **Never** use the `gh` CLI locally — it may not be installed or authenticated.
- The MCP tools use the parameters `owner: "pwretmo"` and `repo: "deep-underworld"`.

GitHub cloud agents (Copilot coding agent) use their built-in GitHub API access instead.

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

| Skill             | Folder               | Purpose                                                       |
| ----------------- | -------------------- | ------------------------------------------------------------- |
| Worktree Workflow | `worktree-workflow/` | How to create, use, and clean up worktrees + push via git/MCP |
| Review Workflow   | `review-workflow/`   | How to read PR diffs, post reviews, and manage labels via MCP |
| Merge Workflow    | `merge-workflow/`    | How to find approved PRs, squash-merge, verify, and clean up  |
| UX Testing        | `ux-testing/`        | How to play-test the game in a browser and dispatch fixes     |

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

PRECHECK: Before any edits, builds, or git commands, verify you are exactly in that worktree path and on that branch. If not, abort immediately and report the violation.

TASK: <description>
ISSUE: #<number> (omit if not implementing a specific issue)

ENGINEERING RULE: Never remove, disable, or downgrade a feature to fix a bug. Fix the root cause while preserving all functionality. See Engineering Quality Standards in copilot-instructions.md.

If an ISSUE number is provided, include "Fixes #<number>" in the PR body and ensure ALL requirements from the issue are implemented — not just some. The reviewer will verify completeness.

Follow the worktree-workflow skill in .github/skills/worktree-workflow/SKILL.md.
When done: commit, push, and create a PR targeting main with the label "agent-work".
```

### Dispatch a Reviewer

```
You are a Reviewer agent for the deep-underworld repo (owner: pwretmo, repo: deep-underworld).
Review PR #<number>.

BLOCKING RULES:
1. Reject any PR that removes, disables, or downgrades existing functionality to fix a bug. The fix must preserve the feature and address the root cause.
2. If the PR references a GitHub issue (Fixes #X), verify that ALL requirements from that issue are implemented. Partial implementations are blocking — list the missing requirements.
See Engineering Quality Standards in copilot-instructions.md.

Follow the review-workflow skill in .github/skills/review-workflow/SKILL.md.
If issues found: post REQUEST_CHANGES review, add "agent-reviewed" label, return the list of issues.
If approved: post APPROVE review, add "agent-reviewed" and "agent-approved" labels.
```

### Re-dispatch Worker with Review Fixes

```
You are a Local Worker agent for the deep-underworld repo (owner: pwretmo, repo: deep-underworld).
Your worktree is at: F:\repos\deep-underworld-worktrees\<slug>
Your branch is: agent/<slug>
PR number: #<number>

PRECHECK: Before any edits, builds, or git commands, verify you are exactly in that worktree path and on that branch. If not, abort immediately and report the violation.

ENGINEERING RULE: Never remove, disable, or downgrade a feature to fix a bug. Fix the root cause while preserving all functionality. If the original fix removed functionality, the new fix must restore it AND address the root cause properly.

FIX THESE REVIEW ISSUES:
<paste review comments here>

Fix the issues, commit, and push. Do not create a new PR.
```

### Dispatch the Merger

```
You are a Merger agent for the deep-underworld repo (owner: pwretmo, repo: deep-underworld).

Follow the merge-workflow skill in .github/skills/merge-workflow/SKILL.md.
Find all open PRs labeled "agent-approved" and squash-merge them one at a time.
After each merge, pull main locally and run npm run build to verify.
Clean up worktrees for any merged local branches.
```

### Dispatch a UX Tester

```
Before dispatching this agent, read .github/skills/ux-testing/SKILL.md in the main thread. Do not skip this step.

You are a UX Tester agent for the deep-underworld repo (owner: pwretmo, repo: deep-underworld).

Before any testing, read these skills:
- .github/skills/ux-testing/SKILL.md
- .github/skills/worktree-workflow/SKILL.md
- .github/skills/review-workflow/SKILL.md
- .github/skills/merge-workflow/SKILL.md

Workflow contract:
1. Start with the browser tool discovery and about:blank liveness check from the ux-testing skill.
2. Use `http://localhost:5173?autoplay` for automated UX testing.
3. Use browser-only evidence gathering; do not substitute code analysis for live testing.
4. BROWSER HYGIENE IS MANDATORY: One browser page at a time. If npm run dev auto-opens a tab, close it before opening your automation page. Never open the game in both an external browser and VS Code Simple Browser. Track all pages and close ALL of them before task_complete. See Browser Hygiene in copilot-instructions.md.
5. For every issue found, follow the Local Worker -> Reviewer -> Merger lifecycle defined in repo instructions. Do not substitute direct code edits, built-in PR generation, or alternate PR flows.
6. Do not stop after issue discovery or worker dispatch. Continue through review, merge, and fix verification unless blocked by a hard-stop condition from the skill.

Play the game and find UX issues. For each issue, dispatch the required follow-up work through the repo workflow.

ENGINEERING RULE: Suggested fixes must never remove, disable, or downgrade a feature. Fix the root cause while preserving all functionality. See Engineering Quality Standards in copilot-instructions.md.

Focus area (optional): <area or "full sweep">

Follow the ux-testing skill in .github/skills/ux-testing/SKILL.md.
When done: return a structured UX test report with all issues found and PRs created.
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
