---
description: "Use when you want to ship an epic across multiple sub-issues in dependency order, running the full worktree, PR, review, fix, merge, and build-verification workflow for each one."
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

## Per-Sub-Issue Workflow

For each eligible sub-issue, run the same end-to-end ship-it workflow defined by the repo:

1. Dispatch Local Worker in a dedicated worktree and require complete implementation for that sub-issue.
2. Require `Fixes #<sub-issue-number>` in the PR body so issue completeness can be reviewed.
3. Dispatch Reviewer and repeat the Local Worker -> Reviewer loop until approved.
4. Dispatch Merger to squash-merge only after approval, then verify `npm run build` on `main`.
5. Stop immediately on any blocker, failed merge gate, or failed post-merge build.
6. Continue with the next eligible dependent sub-issue only after the current one is merged and build-verified.

Hard gates:

- Never remove, disable, or downgrade features to fix bugs; require root-cause fixes.
- Never bypass the repo's review-thread policy for addressed blocking conversations.
- Never run multiple active Worker -> Reviewer -> Merger chains at once for this epic.

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
