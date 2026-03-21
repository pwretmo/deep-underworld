# Agents

Agent roles for the deep-underworld orchestrated workflow.

## Local Worker

**File**: `.github/agents/local-worker.agent.md`

Implements changes in a dedicated git worktree, validates with `npm run build`, pushes, and creates a PR. Can be re-dispatched to fix review comments.

**Skills used**: [Worktree Workflow](.github/skills/worktree-workflow/SKILL.md)

## Reviewer

**File**: `.github/agents/reviewer.agent.md`

Expert code reviewer. Reads PR diffs via GitHub MCP, posts review comments, and manages `agent-reviewed` / `agent-approved` labels. Reviews both local and cloud agent PRs.

**Skills used**: [Review Workflow](.github/skills/review-workflow/SKILL.md)

## Merger

**File**: `.github/agents/merger.agent.md`

Finds PRs labeled `agent-approved`, squash-merges them into `main` one at a time, verifies the build, and cleans up worktrees for local branches.

**Skills used**: [Merge Workflow](.github/skills/merge-workflow/SKILL.md)

## UX Tester

**File**: `.github/agents/ux-tester.agent.md`

Video game UX expert. Launches the dev server, opens the game in Chrome via DevTools MCP, plays through it to find visual, performance, accessibility, and interaction issues, then dispatches Local Worker subagents for fixes.

**Skills used**: [UX Testing](.github/skills/ux-testing/SKILL.md), [Worktree Workflow](.github/skills/worktree-workflow/SKILL.md)
