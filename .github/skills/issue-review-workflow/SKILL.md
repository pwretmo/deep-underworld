---
name: issue-review-workflow
description: "Review GitHub issues and epics using architect -> engineer -> writer passes, recursively inspect sub-issues, research complex topics on the web, update issue bodies/comments, and split or consolidate issue trees until they are implementation-ready."
---

# Issue Review Workflow Skill

Step-by-step instructions for reviewing GitHub issues, researching complex topics, answering open questions, and reshaping issue trees until they are implementation-ready.

## Scope

Use this workflow when the user wants an issue reviewed and tightened for likely implementation by a coding agent:

- Review a single issue deeply
- Review an epic and all sub-issues
- Tighten acceptance criteria
- Answer technical questions in the issue thread
- Split oversized issues into smaller sub-issues
- Consolidate duplicate or overlapping issues
- Update issue bodies/comments with recommended solutions and best practices

Default assumption: a coding agent will implement the reviewed issue unless the user explicitly says review-only or otherwise opts out of downstream implementation.

This workflow prepares the issue tree for implementation. Never implement code, create branches, or open PRs from this workflow. The Issue Reviewer agent does not have the `edit` tool or subagent access. If implementation is needed, report that requirement in your output so the orchestrator dispatches the coding workflow separately.

## Reading The Issue Tree

### Step 1: Read The Root Issue

Fetch the main issue details, comments, and sub-issues:

```text
Tool: mcp_io_github_git_issue_read
Parameters:
  owner: "pwretmo"
  repo: "deep-underworld"
  issue_number: <number>
  method: "get"
```

```text
Tool: mcp_io_github_git_issue_read
Parameters:
  owner: "pwretmo"
  repo: "deep-underworld"
  issue_number: <number>
  method: "get_comments"
```

```text
Tool: mcp_io_github_git_issue_read
Parameters:
  owner: "pwretmo"
  repo: "deep-underworld"
  issue_number: <number>
  method: "get_sub_issues"
```

### Step 2: Read Reachable Sub-Issues Recursively

For every returned sub-issue:

1. Read the issue body
2. Read the comments
3. Read its sub-issues
4. Continue recursively until the tree is exhausted
5. Maintain a visited-issue set. Before reading any issue, check whether its number is already in the set and skip it if so. This is a hard requirement — cyclic issue links must not cause infinite loops or duplicate processing.

### Step 3: Search For Related Or Duplicate Issues When Needed

If the title/body suggests overlap, search the repo issues before recommending a split or merge:

```text
Tool: mcp_io_github_git_search_issues
Parameters:
  owner: "pwretmo"
  repo: "deep-underworld"
  query: "repo:pwretmo/deep-underworld is:issue <keywords from the issue title/body>"
```

Use this to find:

- Duplicates
- Partially overlapping issues
- Existing sub-issues that should be linked instead of recreated
- Related discussions that answer open questions

## Complexity And Research Gate

Web research is mandatory when the issue matter is advanced, niche, or materially uncertain.

Trigger research when any of these is true:

- The issue touches rendering, graphics APIs, shaders, browser platform behavior, physics, audio, performance, memory, accessibility, networking, security, storage, or other expert domains
- The issue proposes a non-trivial architecture or algorithmic change
- The issue text contains open technical questions and the answer is not obvious from repo context
- The workflow would otherwise be guessing at best practices
- The user explicitly asked for best practices, standards, or external knowledge

### Research Quality Bar

When researching, prefer sources in this order:

1. Official standards, official documentation, browser/vendor docs, framework docs
2. Maintainer-authored guidance, engineering handbooks, reputable technical papers
3. High-quality practitioner write-ups with concrete evidence

Avoid low-signal SEO articles, unverified summaries, and single-source speculation.

For architecture-significant recommendations, use at least two strong sources when available.

If browsing or web search is unavailable or returns no usable results:

1. State the limitation explicitly in a GitHub issue comment — not just in the return output.
2. Do not mark the issue as implementation-ready if a research trigger fired and research could not be completed.
3. Report the research limitation in the return format under "Remaining blockers."

## Three-Pass Review Order

Every review cycle must run in this order:

1. **Software architect**
2. **Software engineer**
3. **Technical writer**

Do not skip or reorder these passes.

At the end of each full pass, ask: "Could a coding agent implement this issue now without inventing missing requirements?" If the answer is no, the workflow is not done.

### Pass 1: Software Architect

Review the issue and its sub-issues for structural quality:

- Is the problem statement clear?
- Is the scope too large for one implementation PR?
- Should the issue become an epic with sub-issues?
- Should existing sub-issues be merged, reprioritized, or separated?
- Are dependencies explicit?
- Are acceptance criteria complete and testable?
- Are there product or technical decisions missing that will block implementation?

Architect pass outputs may include:

- Recommended issue split
- Recommended consolidation or duplicate handling
- Explicit dependency ordering
- New acceptance criteria
- Identified blockers or missing prerequisites
- A clearer implementation slice for the next coding agent

### Pass 2: Software Engineer

Review for technical correctness and implementation readiness:

- Is the proposed solution technically sound?
- What edge cases, regressions, or failure modes are missing?
- What performance, memory, accessibility, or maintenance risks exist?
- What tests or verification steps should be required?
- Which open questions can be answered decisively now?

Default behavior: answer open technical questions with the best-supported recommendation you can defend. Do not leave answerable questions vague.

#### Regression Coverage Checkpoint

Before finishing the engineer pass, ask: **"If this feature is implemented and a later PR breaks it, what test would catch that?"**

Categorize the feature by regression risk type and recommend coverage accordingly:

| Risk type | Examples | Recommended coverage |
|---|---|---|
| **Numeric tuning** | Lighting zones, physics constants, timing budgets | Golden-value snapshot tests that assert specific numeric outputs against known-good baselines |
| **Behavioral logic** | AI state machines, collision rules, spawn placement | Behavior / state-transition tests that verify expected outputs for representative inputs |
| **Performance-sensitive** | Particle counts, chunk streaming, frame budgets | Profiling script assertions that enforce measurable performance thresholds |
| **Visual output** | Shaders, post-processing, HUD layout | Note for UX tester verification (screenshot comparison or manual checklist) |

Apply the checkpoint as follows:

1. **Categorize** — determine which risk type(s) the issue falls into. An issue may span multiple types.
2. **Document** — add the recommended regression coverage directly to the issue body (in an `## Regression Coverage` section) or as a sub-issue when the coverage plan is substantial.
3. **Flag when unclear** — if no obvious regression strategy exists for a meaningful part of the feature, add a `## Regression Coverage` section that explicitly states: _"No automated regression strategy identified — requires human review."_ This ensures unresolved coverage gaps are visible, not silently skipped.

Issues leaving the review workflow must have regression coverage either documented or explicitly flagged.

Engineer pass outputs may include:

- Recommended solution and rationale
- Implementation notes or constraints
- Explicit validation guidance
- Research-backed best practices with citations
- Rejected alternatives with brief reasons
- Concrete defaults where the issue previously left implementation-critical questions open
- Regression coverage recommendation or flag for human review

### Pass 3: Technical Writer

Make the issue clear, actionable, and implementation-ready:

- Rewrite ambiguous titles
- Replace vague descriptions with concrete goals
- Turn prose into checklists or acceptance criteria when helpful
- Separate resolved questions from remaining open questions
- Remove duplication and tighten wording
- Ensure issue relationships and next actions are obvious

The technical-writer pass should leave the issue readable by a new engineer without extra oral context.

Assume that "new engineer" may be a coding agent working only from the issue text and linked sub-issues.

## Applying Updates To Issues

### Body Update Policy

When an issue body needs repair, use read-merge-write. Preserve the original intent and rewrite into a structured form rather than replacing it blindly.

Preferred body structure:

```markdown
## Goal

## Problem / Context

## Recommended Solution

## Acceptance Criteria

## Dependencies / Sub-Issues

## Resolved Technical Decisions

## Remaining Open Questions

## References
```

Guidelines:

- Keep original user constraints, examples, and domain context
- Keep existing useful checklists
- Fold comment-thread conclusions back into the body when they are now decisions
- Keep long rationale in comments if it would bloat the issue body
- Make implementation-critical decisions explicit instead of leaving them implied
- Add enough acceptance and verification detail that a coding agent does not need to guess at success criteria

Update an issue with:

```text
Tool: mcp_io_github_git_issue_write
Parameters:
  owner: "pwretmo"
  repo: "deep-underworld"
  issue_number: <number>
  method: "update"
  title: "<updated title if needed>"
  body: "<merged body>"
```

### Comment Update Policy

After material changes, add an issue comment summarizing:

- What was changed
- Which questions were answered
- Which issues were split, linked, reordered, or closed as duplicates
- Which external sources informed the recommendation
- Whether the issue is now ready for implementation by a coding agent
- What remains blocked, if anything

Example:

```text
Tool: mcp_io_github_git_add_issue_comment
Parameters:
  owner: "pwretmo"
  repo: "deep-underworld"
  issue_number: <number>
  body: "Agent review summary:\n- Architect: ...\n- Engineer: ...\n- Writer: ...\n- References: ..."
```

### Creating Or Repairing Sub-Issues

Split an issue when any of these is true:

- It spans multiple independently reviewable deliverables
- It mixes prerequisite work with dependent work
- It contains distinct validation paths
- A single PR would become too large or too risky

Create missing child issues with:

```text
Tool: mcp_io_github_git_issue_write
Parameters:
  owner: "pwretmo"
  repo: "deep-underworld"
  method: "create"
  title: "<new sub-issue title>"
  body: "<new sub-issue body>"
```

Then attach the child issue to the parent:

```text
Tool: mcp_io_github_git_sub_issue_write
Parameters:
  owner: "pwretmo"
  repo: "deep-underworld"
  issue_number: <parent issue number>
  sub_issue_id: <new sub-issue node id>
  method: "add"
```

Use `reprioritize` when order matters and the current sub-issue sequence is wrong.

### Consolidating Or Closing Duplicates

Use the narrowest safe action:

- If two issues are exact duplicates and one is clearly the better canonical issue, close the duplicate with `state_reason: "duplicate"`
- If issues overlap but each contains unique work, do not close either one. Cross-link them and describe the boundary instead.
- If multiple issues should be merged conceptually, rewrite one as the canonical issue and update the others with redirection comments

Exact duplicate close:

```text
Tool: mcp_io_github_git_issue_write
Parameters:
  owner: "pwretmo"
  repo: "deep-underworld"
  issue_number: <duplicate issue number>
  method: "update"
  state: "closed"
  state_reason: "duplicate"
  duplicate_of: <canonical issue number>
```

## Iteration Loop

After any material change, re-read the affected issues and run the full three-pass review again.

Repeat while any pass does one or more of the following:

- Finds a new gap, error, risk, or unanswered question
- Changes an issue body or title
- Posts a new review-summary comment
- Creates, links, removes, or reprioritizes a sub-issue
- Identifies a duplicate or overlap that changes the issue tree

The workflow is complete only when one full architect -> engineer -> technical writer pass produces no new findings and no further issue updates, and the issue is explicit enough for a coding agent to implement without inventing missing requirements.

### Convergence Safety

If the workflow has completed 5 or more full three-pass cycles without converging, pause and evaluate:

- Are the same issues being modified in alternating ways?
- Is a product-direction ambiguity preventing stabilization?
- Is a contradiction in the issue tree causing oscillation?

If any of these is true, stop. Post a blocker comment on the root issue explaining the convergence failure and include it in the return format under "Remaining blockers."

## Stop Conditions

Stop and report a blocker when:

- The issue tree contains contradictory requirements that cannot be resolved from context or high-quality sources
- Product-direction ambiguity remains after technical refinement
- Permissions or tools do not allow the required issue updates
- The issue graph contains a dependency cycle that needs manual product cleanup

When blocked, leave the issue in a clearer state than you found it and post the blocker explicitly.

## Return Format

Always return a structured result:

```text
ISSUE REVIEW RESULT:
- Root issue: #<number>
- Passes completed: <n>
- Research used: yes/no
- Ready for coding agent: yes/no
- Actions taken:
  - Updated #...
  - Created #...
  - Reprioritized sub-issue #...
  - Closed #... as duplicate of #...
- Remaining blockers: none
```
