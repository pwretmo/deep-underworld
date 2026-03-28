---
description: "Use when you want to ship a new change or an existing PR end-to-end through the repo workflow: implement or finish the work, fix review feedback on the current PR branch when needed, and squash-merge to main."
agent: agent
---

# Ship It — Full Workflow

The user wants work taken all the way to merge, whether starting from a new task or an existing pull request.

## Task

${input:task:Describe the change you want}

## Workflow

Execute the full Local Worker -> Reviewer -> fix loop -> Merger workflow.

1. **Inspect** — If the input names an existing PR, inspect its current branch type, review state, labels, and blockers first. Treat `ship-it` as end-to-end shepherding, not merge-only triage.
2. **Implement or Resume** — For new work, dispatch a Local Worker in an isolated worktree to make the change, validate with `npm run build`, and open the PR with `agent-work`. For an existing `agent/` PR, re-dispatch the Local Worker on the same worktree and branch. For an existing `copilot/` PR, update the existing PR branch in place rather than replacing it or opening a new PR.
3. **Review** — Dispatch a Reviewer to evaluate the PR, including linked-issue completeness and external Copilot review state.
4. **Fix Loop** — If review requests changes or blocking review comments remain, continue on the existing PR branch and repeat review until the PR is approved.
5. **Merge** — Dispatch the Merger only after approval. The Merger must re-check review state, handle already-addressed blocking review conversations per the repo policy, squash-merge, verify `npm run build`, and clean up the local worktree.

Hard gates:

- Never bypass the repo's Local Worker -> Reviewer -> Merger lifecycle.
- Never reinterpret an existing-PR `ship-it` request as a merge-only readiness check. If the PR is blocked, return to the fix loop on the existing branch.
- Never treat addressed-but-open blocking review conversations as ignored; resolve them when possible, otherwise acknowledge them in-thread before approval or merge.
- Never merge with unaddressed Copilot or reviewer blockers, or with any outstanding `REQUEST_CHANGES`.

Use the dispatch templates from `.github/copilot-instructions.md` for each step.
