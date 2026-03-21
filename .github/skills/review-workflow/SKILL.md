---
name: review-workflow
description: "Pull request code review using GitHub MCP tools — reading diffs, posting reviews with inline comments, managing agent-reviewed and agent-approved labels."
---

# Review Workflow Skill

Step-by-step instructions for reviewing PRs using GitHub MCP tools.

## Reading a PR

Fetch the PR details and diff:

```
Tool: mcp_io_github_git_pull_request_read
Parameters:
  owner: "pwretmo"
  repo: "deep-underworld"
  pullNumber: <number>
```

This returns the PR title, description, diff, and list of changed files.

## Verifying Issue Completeness

When a PR implements a GitHub issue, verify that **all** requirements from the issue are addressed — not just some.

### Step 1: Extract the Issue Number

Look in the PR description for issue references like `Fixes #42`, `Closes #42`, or `Resolves #42`. Also check the PR title for `#<number>` patterns.

If no issue is linked, skip this section — the PR may be a standalone improvement.

### Step 2: Fetch the Issue Body

```
Tool: mcp_io_github_git_issue_read
Parameters:
  owner: "pwretmo"
  repo: "deep-underworld"
  issue_number: <extracted number>
```

This returns the issue title, body, labels, and comments.

### Step 3: Identify Requirements

Parse the issue body for:

- Numbered acceptance criteria or task lists (`- [ ]` checkboxes)
- Bullet-pointed requirements
- Described behavior changes or features
- If the issue body is unstructured, treat each distinct behavior or feature mentioned as a requirement

### Step 4: Check Each Requirement Against the Diff

For every requirement identified in Step 3, verify that the PR's changed files address it. A requirement is **met** if the diff contains code that implements the described behavior. A requirement is **unmet** if no corresponding change exists in the diff.

### Step 5: Report

If any requirements are unmet, this is a **blocking** review finding — treat it like a bug or missing functionality. Include it in your `REQUEST_CHANGES` review with a clear list:

```
[INCOMPLETE IMPLEMENTATION] This PR references issue #42 but does not fully implement it:
- ✅ Requirement 1: <met — brief note>
- ❌ Requirement 2: <unmet — what's missing>
- ❌ Requirement 3: <unmet — what's missing>
```

If all requirements are met, note this in the approval:

```
Issue #42 completeness: All requirements verified. ✅
```

## Posting a Review

### Request Changes

When issues are found:

```
Tool: mcp_io_github_git_pull_request_review_write
Parameters:
  owner: "pwretmo"
  repo: "deep-underworld"
  pullNumber: <number>
  event: "REQUEST_CHANGES"
  body: "Summary of issues found:\n\n1. Issue one\n2. Issue two"
  comments:
    - path: "src/environment/Ocean.js"
      line: 42
      body: "This texture is never disposed — will cause a memory leak."
    - path: "src/creatures/Anglerfish.js"
      line: 15
      body: "Missing null check — player could be undefined here."
```

### Approve

When the code looks good:

```
Tool: mcp_io_github_git_pull_request_review_write
Parameters:
  owner: "pwretmo"
  repo: "deep-underworld"
  pullNumber: <number>
  event: "APPROVE"
  body: "LGTM. Changes are correct and well-structured."
```

## Managing Labels

After posting any review, add the `agent-reviewed` label:

```
Tool: mcp_io_github_git_issue_write
Parameters:
  owner: "pwretmo"
  repo: "deep-underworld"
  issue_number: <PR number>
  labels: ["agent-reviewed"]
  method: "update"
```

After approving, add both labels:

```
Tool: mcp_io_github_git_issue_write
Parameters:
  owner: "pwretmo"
  repo: "deep-underworld"
  issue_number: <PR number>
  labels: ["agent-reviewed", "agent-approved"]
  method: "update"
```

Note: PRs and issues share the same number space on GitHub. The `issue_write` tool works for both.

## Review → Fix → Re-review Cycle

1. **Reviewer** posts `REQUEST_CHANGES` review with comments
2. **Reviewer** adds `agent-reviewed` label
3. **Reviewer** returns structured issue list to orchestrator
4. **Orchestrator** re-dispatches the worker with review comments inline in the prompt
5. **Worker** fixes issues and pushes
6. **Orchestrator** re-dispatches the reviewer to check the PR again
7. Repeat until approved

### For Cloud Agent PRs (`copilot/` branches)

The cycle is slightly different:

1. **Reviewer** posts `REQUEST_CHANGES` review with comments on the PR
2. The **cloud agent** picks up the comments naturally and pushes fixes
3. **Orchestrator** re-dispatches the reviewer when the cloud agent signals completion

### Coexisting with External GitHub Copilot Reviews

GitHub may be configured with an external Copilot reviewer that automatically reviews every PR. When this is the case:

- **Poll before reviewing**: The orchestrator should use `mcp_io_github_git_pull_request_read` with `method: "get_reviews"` and `method: "get_review_comments"` to check for external reviews before dispatching the local Reviewer.
- **Don't duplicate feedback**: If the external reviewer already flagged an issue, the local Reviewer should skip it and focus on anything the external reviewer missed.
- **Merge readiness**: A PR needs no outstanding `REQUEST_CHANGES` from **any** reviewer (external or local) before it can be merged.
- **Re-poll after fixes**: When a worker pushes fixes, the external reviewer may run again. The orchestrator should poll for new external reviews before re-dispatching the local Reviewer.

## Return Format

Always return a structured result to the orchestrator:

### On Request Changes

```
REVIEW RESULT: REQUEST_CHANGES
PR: #<number>

Issues:
1. <file>:<line> — <description>
2. <file>:<line> — <description>
```

If the rejection is due to feature removal, prefix the issue with `[FEATURE REMOVAL]`:

```
REVIEW RESULT: REQUEST_CHANGES
PR: #<number>

Issues:
1. [FEATURE REMOVAL] <file>:<line> — Removed castShadow to fix GPU stall. Must pre-allocate shadow map instead.
```

If the rejection is due to incomplete issue implementation, prefix with `[INCOMPLETE IMPLEMENTATION]`:

```
REVIEW RESULT: REQUEST_CHANGES
PR: #<number>
Issue: #<issue number>

Issues:
1. [INCOMPLETE IMPLEMENTATION] Issue #42 requires HUD indicator for flashlight — not implemented.
2. [INCOMPLETE IMPLEMENTATION] Issue #42 requires spawn logic update — not implemented.
```

### On Approve

```
REVIEW RESULT: APPROVED
PR: #<number>

Issue completeness: All requirements from #<issue> verified. ✅  (or: No linked issue.)
Summary: <brief description of what the PR does well>
```
