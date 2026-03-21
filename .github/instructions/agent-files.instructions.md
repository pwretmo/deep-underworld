---
description: "Use when editing or creating agent definitions, skills, copilot instructions, prompt files, or other agent customization files. Covers YAML frontmatter, tool restrictions, description keywords, and anti-patterns."
applyTo: .github/agents/*.agent.md, .github/skills/*/SKILL.md, .github/copilot-instructions.md, .github/instructions/*.instructions.md, .github/prompts/*.prompt.md
---

# Agent Customization Guidelines

When editing agent customization files, use the **agent-customization** skill for templates, validation rules, and anti-patterns.

## Key Rules

- **Descriptions are the discovery surface.** Use keyword-rich descriptions with "Use when..." trigger phrases. If keywords aren't in the description, agents won't find it.
- **YAML frontmatter must be valid.** Quote values containing colons. Use spaces, not tabs. Skill `name:` must match the folder name exactly.
- **Minimal tools per agent.** Only include tools the agent actually needs — excess tools dilute focus.
- **Don't duplicate across layers.** Agents say _what_ to do; skills say _how_ (MCP tool params, commands). Don't repeat skill procedures in agent bodies.
- **One workspace instructions file.** Use either `copilot-instructions.md` or `AGENTS.md`, never both.

## This Repo's Conventions

- Agents: `.github/agents/*.agent.md` — all have `user-invocable: false` (subagents only)
- Skills: `.github/skills/<name>/SKILL.md` — contain MCP tool call details
- MCP servers: `io.github.github/github-mcp-server`, `io.github.ChromeDevTools/chrome-devtools-mcp`
- Labels: `agent-work`, `agent-reviewed`, `agent-approved`
- Commit messages: conventional commits (`feat:`, `fix:`, `refactor:`, etc.)
