---
name: merge-workflow
description: "Squash-merge approved PRs using GitHub MCP tools — finding agent-approved PRs, merging, post-merge build verification, worktree cleanup, stop-on-failure."
---

# Merge Workflow Skill

Step-by-step instructions for finding approved PRs, squash-merging, verifying builds, and cleaning up.

## Finding Approved PRs

List open PRs and filter for the `agent-approved` label:

```
Tool: mcp_io_github_git_list_pull_requests
Parameters:
  owner: "pwretmo"
  repo: "deep-underworld"
  state: "open"
```

From the results, select only PRs that have the `agent-approved` label.

If review conversations remain open after the code is fixed, use `.github/skills/review-thread-resolution/SKILL.md` to resolve the thread when possible. If resolution cannot be completed, ensure the feedback is addressed and a reply has been posted in the thread.

## Squash-Merging a PR

Before merging, enforce merge-readiness gates:

1. Poll PR reviews and review comments:

```
Tool: mcp_io_github_git_pull_request_read
Parameters:
  owner: "pwretmo"
  repo: "deep-underworld"
  pullNumber: <number>
  method: "get_reviews"
```

```
Tool: mcp_io_github_git_pull_request_read
Parameters:
  owner: "pwretmo"
  repo: "deep-underworld"
  pullNumber: <number>
  method: "get_review_comments"
```

2. Confirm there is no outstanding `REQUEST_CHANGES` from any reviewer.
3. If blocking review threads remain but the code is fixed, use `.github/skills/review-thread-resolution/SKILL.md` to verify the fix and resolve the thread when possible. If that cannot be done, post a reply in the thread.
4. Confirm there are no unaddressed Copilot comments/threads. Open threads are acceptable only when the feedback is addressed and a reply has been posted in-thread after a failed or unavailable resolution step.
5. If either condition fails, do not merge. Return `FAILED — review blockers remain`.

Merge one PR at a time:

```
Tool: mcp_io_github_git_merge_pull_request
Parameters:
  owner: "pwretmo"
  repo: "deep-underworld"
  pullNumber: <number>
  merge_method: "squash"
  commit_title: "<PR title>"
```

## Post-Merge Verification

After each merge, verify locally:

```powershell
# Navigate to the main repo
cd F:\repos\deep-underworld

# Pull latest main
git pull origin main

# Verify the build
npm run build
```

### If Build Fails

- **Stop immediately** — do not merge any more PRs
- Report the failure with the build error output
- The orchestrator will handle rollback or fixes

### If Build Succeeds

- Proceed to clean up (if local branch) then merge the next PR

## Worktree Cleanup

Only clean up worktrees for **local** branches (prefix `agent/`). Cloud branches (`copilot/`) have no local worktree.

Given a merged branch `agent/<slug>`:

```powershell
# Check if worktree exists
git worktree list

# Remove the worktree
git worktree remove F:\repos\deep-underworld-worktrees\<slug> --force

# Remove any residual files that git didn't clean up (node_modules, build artifacts, etc.)
if (Test-Path F:\repos\deep-underworld-worktrees\<slug>) { Remove-Item F:\repos\deep-underworld-worktrees\<slug> -Recurse -Force }

# Prune stale references
git worktree prune

# Delete the local branch (force required — squash merge leaves tip off main)
git branch -D agent/<slug>
```

If the worktree directory doesn't exist (already cleaned), just prune and move on.

## Complete Merge Sequence

```
For each approved PR:
  1. Poll reviews + review comments
  2. IF code is fixed but review threads remain → use the review-thread-resolution skill and resolve the thread when possible, otherwise post a reply in the thread
  3. IF blockers still remain → stop, report
  4. Squash-merge via MCP
  5. git pull origin main
  6. npm run build
  7. IF FAIL → stop, report
  8. IF local branch → remove worktree, prune, delete branch
  9. Report success, continue to next PR
```

## Return Format

```
MERGE RESULTS:
- PR #12: merged ✓ (worktree cleaned: yes)
- PR #15: merged ✓ (worktree cleaned: n/a — cloud branch)
- PR #18: FAILED — build error after merge

Total: 2 merged, 1 failed
```
