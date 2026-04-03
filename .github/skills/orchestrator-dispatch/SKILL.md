---
name: orchestrator-dispatch
description: "Dispatch templates, parallelization rules, and compliance requirements for the local VS Code orchestrator. Use when dispatching Local Worker, Reviewer, Merger, Issue Reviewer, or UX Tester subagents, or when deciding what can run in parallel."
---

# Orchestrator Dispatch Skill

These dispatch templates and rules are for the **local VS Code orchestrator only**. Cloud agents should ignore this skill.

## Orchestrator Compliance

Before dispatching a subagent for any skill-governed workflow, the orchestrator must read the referenced skill file in the main thread first. Dispatching a named agent without first loading its required skill is a workflow violation.

The dispatch prompt must restate the non-negotiable parts of the workflow when the skill defines hard-stop or blocking behavior. For UX testing, that includes browser-tool liveness checks, `?autoplay` for automated runs, browser-only evidence gathering, and the full Local Worker -> Reviewer -> Merger lifecycle for fixes.

If this repository defines an explicit agent workflow for a task, do not substitute alternate PR or review flows just because another path is available in the tool environment. Follow the repository workflow unless the user explicitly asks to override it.

## Ship-It Interpretation

When the user asks to `ship-it` an existing PR or names a specific PR number, interpret that as an end-to-end request to shepherd the PR through the remaining workflow steps, not as a merge-only readiness check. Inspect the PR state first. If it is missing `agent-approved`, has an outstanding `REQUEST_CHANGES`, or has blocking review comments or threads, return to the fix loop on the existing PR branch and continue Worker -> Reviewer -> Merger in that order. Only dispatch the Merger after the PR is actually merge-ready.

For existing `agent/` PRs, use the Local Worker re-dispatch template and current worktree. For existing `copilot/` PRs, update the existing PR branch in place rather than forcing the local worktree template onto a cloud branch.

The main conversation agent acts as orchestrator. Example dispatch prompts:

## Dispatch an Issue Reviewer

```
Before dispatching this agent, read .github/skills/issue-review-workflow/SKILL.md in the main thread. Do not skip this step.

You are an Issue Reviewer agent for the deep-underworld repo (owner: pwretmo, repo: deep-underworld).
Target issue: #<number>
Focus area (optional): <area or "full issue tree">

Read this skill before starting:
- .github/skills/issue-review-workflow/SKILL.md

Non-negotiables:
1. Read the target issue, its comments, and all reachable sub-issues before making any modifications. Never write to an issue you have not read.
2. Always assume a coding agent will implement the issue after review. Only drop this assumption if the user explicitly says "review only" or "no implementation planned."
3. If the subject is advanced, niche, architecture-heavy, or otherwise uncertain, research high-quality external sources and cite them in the issue updates.
4. Run the issue through these roles in order: software architect -> software engineer -> technical writer.
5. Apply findings directly to GitHub issues: update bodies/comments, create or reprioritize sub-issues, and close only exact duplicates with a clear canonical replacement.
6. If your own changes reveal new findings, re-read the affected issue tree and repeat the full pass until stable.
7. Never implement code, create branches, or open PRs. If the issue requires implementation, state that in your output so the orchestrator can dispatch the coding workflow separately.

Return `ISSUE REVIEW RESULT`, then call task_complete.
```

## Dispatch a Local Worker

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

## Dispatch a Reviewer

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

## Re-dispatch Worker with Review Fixes

This template applies to local `agent/` branches. For an existing `copilot/` PR, keep the same fix-loop intent but update the existing cloud branch in place instead of recreating a local worktree.

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

## Dispatch the Merger

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

## Dispatch a UX Tester

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
