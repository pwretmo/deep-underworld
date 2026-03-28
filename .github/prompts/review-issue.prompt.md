---
description: "Use when you want to review a GitHub issue or epic, inspect sub-issues recursively, research advanced topics on the web, and rewrite the issue tree into an implementation-ready plan for a coding agent."
agent: agent
---

# Review Issue — Iterative Issue Grooming Workflow

Run the full issue-review workflow for GitHub issue #${input:issueNumber:Issue number (e.g. 53)}.

## Goal

Transform the target issue and its reachable sub-issues into an implementation-ready plan for a coding agent by iterating:

software architect -> software engineer -> technical writer

until a full pass produces no new findings.

## Dispatch Instructions

1. Read `.github/skills/issue-review-workflow/SKILL.md` in the main thread before dispatching. Do not skip this step.
2. Dispatch the **Issue Reviewer** subagent (exact agent name: `Issue Reviewer`) on issue #${input:issueNumber} using the dispatch template from `.github/copilot-instructions.md`.
3. Pass all non-negotiables from the dispatch template verbatim in the dispatch prompt.

## What This Workflow Does

The Issue Reviewer will:

1. Recursively read the target issue, its comments, and all reachable sub-issues.
2. Research advanced topics on the web when the issue's complexity demands it.
3. Run the issue tree through three review passes in order: software architect -> software engineer -> technical writer.
4. Apply findings directly to GitHub issues: update bodies and comments, create or reprioritize sub-issues, and close only exact duplicates.
5. Re-read the affected issue tree after any material change and repeat until stable.
6. Report back when the issue is implementation-ready or when blocked.

## Orchestrator Hard Gates

These rules bind the orchestrator, not just the Issue Reviewer subagent:

- **No code from this workflow.** Neither the orchestrator nor the Issue Reviewer may create code changes, branches, or PRs. If the user also wants implementation, dispatch the coding workflow (Local Worker -> Reviewer -> Merger) separately after the review completes. Never combine issue review and code implementation in the same Issue Reviewer dispatch.
- **Skill read is mandatory twice.** The orchestrator must read the issue-review-workflow skill before dispatching. The Issue Reviewer must read it again in its own run. If either read fails, stop.
- **Research integrity enforcement.** If the Issue Reviewer reports that web research was unavailable but the issue topic triggered a mandatory research gate, do not accept the result as implementation-ready. Report the limitation to the user.
- **Duplicate safety.** Do not accept results that closed issues beyond exact duplicates. Only exact duplicates with a clear canonical replacement may be closed.
- **Implementation readiness is the success criterion.** The review is not done until the issue tree is explicit enough for a coding agent to implement without inventing missing requirements, or a real blocker has been reported.

## Final Report

Return:

1. Root issue number
2. Number of architect/engineer/writer passes completed
3. Whether external research was used (and whether any mandatory research could not be completed)
4. Issues updated, created, or restructured
5. Whether the issue is now ready for a coding agent to implement
6. Duplicates or consolidations performed
7. Remaining blockers, if any
