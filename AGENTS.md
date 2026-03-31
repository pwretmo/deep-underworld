# Agent Instructions

- Use CRLF newlines and UTF-8 encoding.
- Read `.github/copilot-instructions.md` at the start of work in this repository for repo workflow, engineering constraints, and testing rules.
- When a task matches a repo skill, load the corresponding `.github/skills/<name>/SKILL.md` before acting.
- Treat `.github/agents/*.agent.md`, `.github/prompts/*.prompt.md`, and `.github/instructions/*.instructions.md` as repository workflow assets that may define supporting procedures and constraints.
- If guidance conflicts, prefer direct user instructions, then this file, then the referenced `.github` files.

