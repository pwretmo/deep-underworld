# Copilot Instructions — deep-underworld

## Repository Facts

- **Repository**: `pwretmo/deep-underworld`
- **Owner**: `pwretmo`
- **Origin**: `https://github.com/pwretmo/deep-underworld`
- **Default branch**: `main`
- **Local path**: `F:\repos\deep-underworld`

When any agent or skill needs the repo owner, name, or URL — use the values above.
Never prompt the user for repository identity information.

## Project Overview

This is a Three.js deep-ocean exploration horror game built with Vite.

- **Language**: JavaScript (ES modules)
- **Build**: `npm run build` (Vite)
- **Dev server**: `npm run dev`
- **No test framework yet** — validate changes by running `npm run build` successfully.

## Agent Workflow Conventions

### Branch Naming

| Origin                       | Prefix     | Example                     |
| ---------------------------- | ---------- | --------------------------- |
| Local worker agent           | `agent/`   | `agent/add-bioluminescence` |
| GitHub cloud agent (Copilot) | `copilot/` | `copilot/fix-123`           |

### Worktree Isolation

Local subagents **must** work in a dedicated git worktree, never directly on `main`.
Worktrees are created at `F:\repos\deep-underworld-<slug>` where `<slug>` matches the branch suffix.

### GitHub Operations

**Always use the GitHub MCP server tools** (`mcp_io_github_git_*`) for all GitHub operations:

- Creating branches, PRs, reading files, searching code, merging PRs, etc.
- **Never** use the `gh` CLI. It may not be installed or authenticated.
- The MCP tools use the parameters `owner: "pwretmo"` and `repo: "deep-underworld"`.

### PR Lifecycle

1. **Worker** creates a branch, implements changes, pushes, and opens a PR.
2. **Reviewer** reviews the PR, leaves comments, requests changes if needed.
3. **Worker** fixes issues found in review (in its worktree).
4. **Reviewer** re-reviews until approved.
5. **Merger** merges approved PRs into `main` one at a time, verifies build, cleans up worktrees.

### Labels

- `agent-work` — PR was created by a local worker agent
- `agent-reviewed` — PR has passed agent review
- `agent-approved` — PR is approved and ready to merge

### Commit Messages

Use conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`.

## Agent Roles

Four agent roles are defined in `.github/agents/`:

| Agent            | File                    | Purpose                                                           |
| ---------------- | ----------------------- | ----------------------------------------------------------------- |
| **Local Worker** | `local-worker.agent.md` | Implements changes in a worktree, pushes, creates PR              |
| **Reviewer**     | `reviewer.agent.md`     | Expert code reviewer — reads diffs, posts reviews, manages labels |
| **Merger**       | `merger.agent.md`       | Squash-merges approved PRs, verifies build, cleans up             |
| **UX Tester**    | `ux-tester.agent.md`    | Plays the game in a browser, finds UX issues, dispatches workers  |

Supporting skills in `.github/skills/`:

| Skill             | Folder               | Purpose                                                       |
| ----------------- | -------------------- | ------------------------------------------------------------- |
| Worktree Workflow | `worktree-workflow/` | How to create, use, and clean up worktrees + push via git/MCP |
| Review Workflow   | `review-workflow/`   | How to read PR diffs, post reviews, and manage labels via MCP |
| Merge Workflow    | `merge-workflow/`    | How to find approved PRs, squash-merge, verify, and clean up  |
| UX Testing        | `ux-testing/`        | How to play-test the game in a browser and dispatch fixes     |

## Orchestrator Patterns

The main conversation agent acts as orchestrator. Example dispatch prompts:

### Dispatch a Local Worker

```
You are a Local Worker agent for the deep-underworld repo (owner: pwretmo, repo: deep-underworld).
Your worktree is at: F:\repos\deep-underworld-<slug>
Your branch is: agent/<slug>

TASK: <description>

Follow the worktree-workflow skill in .github/skills/worktree-workflow/SKILL.md.
When done: commit, push, and create a PR targeting main with the label "agent-work".
```

### Dispatch a Reviewer

```
You are a Reviewer agent for the deep-underworld repo (owner: pwretmo, repo: deep-underworld).
Review PR #<number>.

Follow the review-workflow skill in .github/skills/review-workflow/SKILL.md.
If issues found: post REQUEST_CHANGES review, add "agent-reviewed" label, return the list of issues.
If approved: post APPROVE review, add "agent-reviewed" and "agent-approved" labels.
```

### Re-dispatch Worker with Review Fixes

```
You are a Local Worker agent for the deep-underworld repo (owner: pwretmo, repo: deep-underworld).
Your worktree is at: F:\repos\deep-underworld-<slug>
Your branch is: agent/<slug>
PR number: #<number>

FIX THESE REVIEW ISSUES:
<paste review comments here>

Fix the issues, commit, and push. Do not create a new PR.
```

### Dispatch the Merger

```
You are a Merger agent for the deep-underworld repo (owner: pwretmo, repo: deep-underworld).

Follow the merge-workflow skill in .github/skills/merge-workflow/SKILL.md.
Find all open PRs labeled "agent-approved" and squash-merge them one at a time.
After each merge, pull main locally and run npm run build to verify.
Clean up worktrees for any merged local branches.
```

### Dispatch a UX Tester

```
You are a UX Tester agent for the deep-underworld repo (owner: pwretmo, repo: deep-underworld).

Play the game and find UX issues. For each major issue, dispatch a Local Worker to fix it.

Focus area (optional): <area or "full sweep">

Follow the ux-testing skill in .github/skills/ux-testing/SKILL.md.
When done: return a structured UX test report with all issues found and PRs created.
```
