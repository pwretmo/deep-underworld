---
description: "Run the full ship-it workflow for an epic and all sub-issues in dependency order, one-by-one, from implementation through merge and build verification. Use when you want a single orchestrator run for an entire epic."
agent: agent
---

# Ship Epic — Dependency-Ordered Workflow

Run the full ship-it workflow for Epic #${input:epicNumber:Epic issue number (e.g. 53)} and all of its sub-issues in strict dependency order.

## Goal

Complete each sub-issue end-to-end before starting the next eligible one:
implement -> review -> fix loop (if needed) -> merge -> `npm run build` verify.

## Execution Contract

1. Discover all sub-issues for Epic #${input:epicNumber}.
2. Build a dependency graph from issue links/relationships (depends on, blocked by, prerequisite notes).
3. Compute a topological execution order.
4. If multiple sub-issues are eligible at the same time, break ties by:
   1. Lowest dependency depth first.
   2. Then lowest issue number.
5. Process only one sub-issue at a time (single active Worker -> Reviewer -> Merger chain).
6. Never start a sub-issue until all its prerequisites are merged into `main` and build-verified.
7. If there is a dependency cycle or ambiguity, stop and report exact issues involved.

## Per-Sub-Issue Steps

1. Dispatch Local Worker in a dedicated worktree/branch.
2. Require complete implementation for that sub-issue.
3. Enforce engineering rule: never remove, disable, or downgrade features to fix bugs; fix root cause.
4. Open PR labeled `agent-work` with `Fixes #<sub-issue-number>` in the PR body.
5. Dispatch Reviewer.
6. If review requests changes (including unresolved Copilot comments/threads), re-dispatch Local Worker on the same PR branch and repeat review.
7. After approval, dispatch Merger to squash-merge.
8. Pull/update `main` and run `npm run build`.
9. If build fails, stop immediately and report blocker details.
10. Mark sub-issue complete and continue with next eligible dependent sub-issue.

## Final Report

Return a table with:

1. Execution position
2. Sub-issue number
3. Resolved dependencies
4. PR number
5. Review outcome
6. Merge commit SHA
7. Post-merge `npm run build` result
8. Final status (`completed` or `blocked`)
9. Blocker notes (if any)

If blocked, include:

1. Blocked sub-issue
2. Blocking dependency or failing step
3. Exact tool/command that failed
4. Recommended manual unblock action

Use dispatch templates and workflow rules from `.github/copilot-instructions.md`.
