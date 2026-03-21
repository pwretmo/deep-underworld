# Merge Workflow Skill

Step-by-step instructions for finding approved PRs, squash-merging, verifying builds, and cleaning up.

## Repository Facts

- **Owner**: `pwretmo`
- **Repo**: `deep-underworld`
- **Local path**: `F:\repos\deep-underworld`
- **Build command**: `npm run build`

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

## Squash-Merging a PR

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
git worktree remove F:\repos\deep-underworld-<slug> --force

# Prune stale references
git worktree prune

# Delete the local branch tracking reference
git branch -d agent/<slug>
```

If the worktree directory doesn't exist (already cleaned), just prune and move on.

## Complete Merge Sequence

```
For each approved PR:
  1. Squash-merge via MCP
  2. git pull origin main
  3. npm run build
  4. IF FAIL → stop, report
  5. IF local branch → remove worktree, prune, delete branch
  6. Report success, continue to next PR
```

## Return Format

```
MERGE RESULTS:
- PR #12: merged ✓ (worktree cleaned: yes)
- PR #15: merged ✓ (worktree cleaned: n/a — cloud branch)
- PR #18: FAILED — build error after merge

Total: 2 merged, 1 failed
```
