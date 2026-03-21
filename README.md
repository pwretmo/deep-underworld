# Deep Underworld

A Three.js deep-ocean exploration horror game built with Vite.

## Getting Started

```bash
npm install
npm run dev       # Start dev server at http://localhost:5173
npm run build     # Production build
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

#### UX test the game

- *"Play-test the game and find UX issues. Do a full sweep."*
- *"Play-test the creature encounters — swim deep and check for visual glitches and performance drops."*
- *"Run a UX test focused on the HUD readability and accessibility."*

### How It Works

1. You describe what you want in plain language
2. The orchestrator creates a worktree + branch and dispatches a **Local Worker**
3. The worker implements changes, runs `npm run build`, pushes, and opens a PR
4. You (or the orchestrator) dispatches a **Reviewer** to check the PR
5. If changes are needed, the worker is re-dispatched with the review comments
6. Once approved, the **Merger** squash-merges into `main` and verifies the build

The **UX Tester** combines steps 1–3 automatically: it plays the game, finds issues, and dispatches workers for each one.

### Agent Configuration

Agent definitions and skills live in `.github/`:

```text
.github/
  copilot-instructions.md          # Repo-wide conventions and dispatch templates
  agents/
    local-worker.agent.md          # Local Worker agent
    reviewer.agent.md              # Reviewer agent
    merger.agent.md                # Merger agent
    ux-tester.agent.md             # UX Tester agent
  instructions/
    agent-files.instructions.md    # Auto-loaded when editing agent/skill files
  skills/
    worktree-workflow/SKILL.md     # Git worktree lifecycle
    review-workflow/SKILL.md       # PR review via GitHub MCP
    merge-workflow/SKILL.md        # Squash-merge pipeline
    ux-testing/SKILL.md            # Browser-based game testing
.vscode/
  mcp.json                         # MCP server declarations for agents
```
