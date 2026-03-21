---
name: worktree-workflow
description: 'Git worktree creation, branch management, pushing, PR creation via MCP, and cleanup for isolated local agent work.'
---

# Worktree Workflow Skill

Step-by-step instructions for creating, using, and cleaning up git worktrees for local agent work.

## Prerequisites

- You are working in the `pwretmo/deep-underworld` repository
- Local path: `F:\repos\deep-underworld`
- Worktrees are created at: `F:\repos\deep-underworld-<slug>`

## Creating a Worktree

The **orchestrator** creates the worktree before dispatching a worker. The worker receives the path.

```powershell
# From the main repo directory
cd F:\repos\deep-underworld

# Fetch latest main
git fetch origin main

# Create worktree with a new branch based on latest main
git worktree add F:\repos\deep-underworld-<slug> -b agent/<slug> origin/main
```

Where `<slug>` is a short kebab-case name for the task (e.g., `add-fog`, `fix-camera`, `refactor-creatures`).

## Working in a Worktree

```powershell
# Navigate to the worktree
cd F:\repos\deep-underworld-<slug>

# Install dependencies (worktree shares git but not node_modules)
npm install

# ... make changes ...

# Validate
npm run build
```

## Committing and Pushing

```powershell
# Stage all changes
git add -A

# Commit with a conventional commit message
git commit -m "feat: add volumetric fog to ocean scene"

# Push the branch (first push needs -u)
git push -u origin agent/<slug>
```

For subsequent pushes (e.g., after fixing review comments):

```powershell
git add -A
git commit -m "fix: address review comments"
git push
```

## Creating a PR via MCP

After pushing, create the PR using the GitHub MCP server:

```
Tool: mcp_io_github_git_create_pull_request
Parameters:
  owner: "pwretmo"
  repo: "deep-underworld"
  title: "feat: add volumetric fog to ocean scene"
  body: "Description of what was changed and why..."
  base: "main"
  head: "agent/<slug>"
```

Then add the `agent-work` label:

```
Tool: mcp_io_github_git_issue_write
Parameters:
  owner: "pwretmo"
  repo: "deep-underworld"
  issue_number: <PR number>
  labels: ["agent-work"]
  method: "update"
```

## Cleaning Up (After Merge)

The **merger agent** handles cleanup after a PR is merged:

```powershell
# Remove the worktree
git worktree remove F:\repos\deep-underworld-<slug> --force

# Prune stale worktree references
git worktree prune

# Delete the local branch
git branch -d agent/<slug>
```

## Important Rules

- Each worktree is isolated — changes in one worktree do not affect another
- Always `npm install` in a new worktree (node_modules is not shared)
- Never work directly on `main`
- Use `git push` in the terminal for pushing — do not use MCP for pushing
- Use MCP tools for PR creation and label management
