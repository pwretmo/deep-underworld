---
description: "Use when you want to ship a change end-to-end through the repo workflow: implement in a worktree, open a PR, review it, fix feedback, and squash-merge to main."
agent: agent
---

# Ship It — Full Workflow

The user wants a change implemented and taken all the way to merge.

## Task

${input:task:Describe the change you want}

## Workflow

Execute the full Local Worker -> Reviewer -> fix loop -> Merger workflow.

1. **Implement** — Dispatch a Local Worker in an isolated worktree to make the change, validate with `npm run build`, and open the PR with `agent-work`.
2. **Review** — Dispatch a Reviewer to evaluate the PR, including linked-issue completeness and external Copilot review state.
3. **Fix Loop** — If review requests changes, re-dispatch the same Local Worker on the same branch and repeat review until the PR is approved.
4. **Merge** — Dispatch the Merger only after approval. The Merger must re-check review state, handle already-addressed blocking review conversations per the repo policy, squash-merge, verify `npm run build`, and clean up the local worktree.

Hard gates:

- Never bypass the repo's Local Worker -> Reviewer -> Merger lifecycle.
- Never treat addressed-but-open blocking review conversations as ignored; resolve them when possible, otherwise acknowledge them in-thread before approval or merge.
- Never merge with unaddressed Copilot or reviewer blockers, or with any outstanding `REQUEST_CHANGES`.

Use the dispatch templates from `.github/copilot-instructions.md` for each step.
