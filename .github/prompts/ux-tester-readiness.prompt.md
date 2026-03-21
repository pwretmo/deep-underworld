# UX Tester Readiness Checklist

Before dispatching the UX Tester agent, verify these prerequisites:

## Infrastructure

- [ ] Chrome DevTools MCP server is running and accessible
- [ ] GitHub MCP server (GitHub Copilot API) is authenticated
- [ ] `npm install` completed successfully in repo
- [ ] All npm dev tools installed: eslint, lighthouse, typescript, vite

## Game Runtime

- [ ] `npm run dev` starts the dev server without errors
- [ ] Dev server listens on predictable port (default: 5173)
- [ ] Game loads in Chrome without console errors
- [ ] Three.js renderer initializes (check console for WebGL context)
- [ ] At least one creature spawns or is visible in game world

## Agent Dependencies

- [ ] Local Worker agent can create worktrees and push commits via GitHub MCP
- [ ] Reviewer agent can read PR diffs and post reviews via GitHub MCP
- [ ] Merger agent can squash-merge PRs via GitHub MCP
- [ ] All three subagents have proper `tools` restrictions in their YAML frontmatter

## Skills Validation

- [ ] `.github/skills/ux-testing/SKILL.md` procedures match Chrome DevTools MCP API
- [ ] `.github/skills/worktree-workflow/SKILL.md` has correct MCP tool calls
- [ ] `.github/skills/review-workflow/SKILL.md` has correct MCP tool calls
- [ ] `.github/skills/merge-workflow/SKILL.md` has correct MCP tool calls

## Known Risks

- **Chrome DevTools MCP stability** — may timeout or lose connection during long sessions
- **Three.js game initialization** — creature spawning or physics might fail in headless Chrome
- **Subagent coordination overhead** — multiple dispatches (Worker → Reviewer → Merger) may accumulate latency
- **Game state persistence** — dev server may not persist state across tool invocations

## Recommended First Test

Start with a **narrow focus area** (e.g., "HUD readability" or "main menu performance") rather than a full sweep. This limits scope and makes debugging easier if the agent gets stuck.

## Success Criteria

Agent successfully completes when:

1. Launches game in Chrome via Chrome DevTools MCP
2. Takes screenshots and logs console output
3. Identifies at least one UX issue
4. Dispatches Local Worker to fix it
5. Dispatches Reviewer to review the fix PR
6. Dispatches Merger to merge the approved PR
7. Re-launches game and verifies fix worked
