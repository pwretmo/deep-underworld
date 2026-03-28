# Deep Underworld

A Three.js deep-ocean exploration horror game built with Vite.

## Getting Started

```bash
npm install
npm run dev       # Start dev server at http://localhost:5173
npm run build     # Production build
npm run preview   # Preview production build at http://localhost:4173
```

## Startup Preload And Cache

- A menu-idle preload phase warms non-audio systems after page load and before Begin Descent.
- Begin Descent always takes priority and never waits for preload completion.
- On valid repeat-session cache hits, startup uses persisted preload targets as advisory hints to skip redundant lookup warmup and speed descent-time preload catch-up.
- Audio remains gesture-gated and is not resumed/initialized by preload work.
- Procedural startup metadata stays tiny in localStorage; larger snapshots use IndexedDB when available.
- Cache key invalidation uses: `gameVersion + worldSeed + qualityTier + schemaVersion`.
- If cache entries are invalid/stale/unreadable, or storage APIs are unavailable/restricted/quota-limited, gameplay cleanly falls back to the standard warmup path.

## AI Agent Workflow

This repo includes custom Copilot agents that automate development tasks. You talk to the main chat agent (the orchestrator), and it dispatches specialized subagents for you.

### Agents

| Agent | What it does |
| --- | --- |
| **Local Worker** | Implements a code change in an isolated git worktree, validates the build, pushes, and opens a PR |
| **Reviewer** | Reviews a PR diff, posts detailed review comments, approves or requests changes |
| **Merger** | Finds approved PRs, squash-merges them into `main`, verifies the build, cleans up |
| **UX Tester** | Launches the game in a browser, plays it to find issues, dispatches Local Workers to fix them |

### Example Prompts

These are prompts you type into the VS Code Copilot chat. The orchestrator will pick the right agent automatically.

#### Implement a feature

- *"Add bioluminescent particles that trail behind the player as they swim deeper."*
- *"Create a new creature called DeathJelly that appears below 500m depth."*
- *"Make the HUD show an oxygen meter that depletes over time."*

#### Fix a bug

- *"The camera clips through terrain when the player swims into walls. Fix it."*
- *"There's a console error about disposed geometry in the Anglerfish. Track it down and fix it."*

#### Review a PR

- *"Review PR #5."*
- *"Review all open PRs labeled agent-work."*

#### Merge approved work

- *"Merge all approved PRs."*

#### Ship it (full workflow)

Use `#prompt:ship-it` to run the entire pipeline — implement, review, fix, and merge — in one shot:

- *`#prompt:ship-it` Add bioluminescent particles that trail behind the player*
- *`#prompt:ship-it` Fix the camera clipping through terrain*

#### Ship an epic (multi-issue workflow)

Use `#prompt:ship-epic` to process an entire epic's sub-issues in dependency order:

- *`#prompt:ship-epic` 53*

#### UX test the game

- *"Play-test the game and find UX issues. Do a full sweep."*
- *"Play-test the creature encounters — swim deep and check for visual glitches and performance drops."*
- *"Run a UX test focused on the HUD readability and accessibility."*

#### Pre-flight check for UX testing

Use `#prompt:ux-tester-readiness` to verify infrastructure, game runtime, and agent dependencies before dispatching the UX Tester.

### How It Works

1. You describe what you want in plain language
2. The orchestrator creates a worktree + branch and dispatches a **Local Worker**
3. The worker implements changes, runs `npm run build`, pushes, and opens a PR
4. You (or the orchestrator) dispatches a **Reviewer** to check the PR
5. If changes are needed, the worker is re-dispatched with the review comments
6. Once approved, the **Merger** squash-merges into `main` and verifies the build

The **UX Tester** combines steps 1–3 automatically: it plays the game, finds issues, and dispatches workers for each one.

### Custom Agents

Agent definitions live in `.github/agents/`. All agents are orchestrator-dispatched (not user-invocable directly).

| Agent | File | Description |
| --- | --- | --- |
| **Local Worker** | `.github/agents/local-worker.agent.md` | Implements code changes in a git worktree branch. Handles feature development, bug fixes, and review fix-ups. Pushes commits and creates PRs via MCP. |
| **Reviewer** | `.github/agents/reviewer.agent.md` | Expert code reviewer for Three.js game code. Reads PR diffs via GitHub MCP, posts inline review comments, manages `agent-reviewed` and `agent-approved` labels. |
| **Merger** | `.github/agents/merger.agent.md` | Squash-merges `agent-approved` PRs into `main` one at a time. Verifies builds after each merge and cleans up worktrees. |
| **UX Tester** | `.github/agents/ux-tester.agent.md` | Video game UX orchestrator. Launches the game with `?autoplay` in a browser, plays it to find visual, performance, accessibility, and usability issues. Dispatches Local Workers, Reviewers, and Mergers to fix, review, and merge each issue. Closes all browser windows when done. |

### Skills

Skills provide domain-specific procedural knowledge that agents reference during execution. They live in `.github/skills/`.

| Skill | File | Description |
| --- | --- | --- |
| **Worktree Workflow** | `.github/skills/worktree-workflow/SKILL.md` | Git worktree creation, branch management, pushing, PR creation via MCP, and cleanup for isolated local agent work. |
| **Review Workflow** | `.github/skills/review-workflow/SKILL.md` | Pull request code review using GitHub MCP tools — reading diffs, posting reviews with inline comments, managing labels. |
| **Merge Workflow** | `.github/skills/merge-workflow/SKILL.md` | Squash-merge approved PRs using GitHub MCP tools — finding `agent-approved` PRs, merging, post-merge build verification, worktree cleanup. |
| **UX Testing** | `.github/skills/ux-testing/SKILL.md` | Browser-based UX testing for Three.js games using Chrome DevTools MCP — screenshots, keyboard input, console monitoring, performance tracing, memory analysis, and dispatching fix workers. |

### Prompt Files

Reusable prompt templates live in `.github/prompts/`. Reference them in chat with `#prompt:<name>`.

| Prompt | File | Description |
| --- | --- | --- |
| **ship-it** | `.github/prompts/ship-it.prompt.md` | Full end-to-end workflow: implement in a worktree, review the PR, fix any review issues, and squash-merge into `main`. Use when you want a single prompt to go from idea to merged code. |
| **ship-epic** | `.github/prompts/ship-epic.prompt.md` | Run the full ship-it workflow for an epic and all sub-issues in dependency order, one-by-one, from implementation through merge and build verification. |
| **ux-tester-readiness** | `.github/prompts/ux-tester-readiness.prompt.md` | Pre-flight checklist to verify infrastructure, game runtime, agent dependencies, and skills before dispatching the UX Tester agent. |

### Instructions

Auto-loaded instruction files in `.github/instructions/` provide context-specific rules when editing certain file types.

| Instruction | File | Applies To |
| --- | --- | --- |
| **Agent Files** | `.github/instructions/agent-files.instructions.md` | `*.agent.md`, `SKILL.md`, `copilot-instructions.md`, `*.instructions.md`, `*.prompt.md` |

### Configuration

```text
.github/
  copilot-instructions.md          # Repo-wide conventions and dispatch templates
.vscode/
  mcp.json                         # MCP server declarations for agents
```
