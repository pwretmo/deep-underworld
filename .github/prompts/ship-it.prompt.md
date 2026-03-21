---
description: "Full end-to-end workflow: implement in a worktree, review the PR, fix any review issues, and squash-merge into main. Use when you want a single prompt to go from idea to merged code."
agent: agent
---

# Ship It — Full Workflow

The user wants a change implemented and taken all the way to merge.

## Task

${input:task:Describe the change you want}

## Workflow

Execute these steps sequentially:

1. **Implement** — Dispatch a Local Worker to implement the change in an isolated worktree, validate the build, push, and open a PR with the `agent-work` label.
2. **Review** — Dispatch a Reviewer to review the PR. If changes are requested, continue to step 3. If approved, skip to step 4.
3. **Fix** — Re-dispatch the Local Worker with the review comments. It fixes the issues, commits, and pushes. Then go back to step 2 for re-review.
4. **Merge** — Dispatch the Merger to squash-merge the approved PR into `main`, verify the build, and clean up the worktree.

Use the dispatch templates from `.github/copilot-instructions.md` for each step.
