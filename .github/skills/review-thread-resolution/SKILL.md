---
name: review-thread-resolution
description: "Handle addressed GitHub PR review conversations by verifying the code fix, resolving the thread when possible, and falling back to a reply in the thread when resolution cannot be completed. Use when review comments block approval or merge and the feedback has already been addressed in code."
---

# Review Thread Resolution Skill

Use this skill when a PR's code is ready, the blocking feedback has been addressed, and you need to clear the review-thread gate before approval or merge.

## When To Use

- Unresolved Copilot or human review threads are the last merge blocker
- The code change that addressed a review comment has already been verified
- GitHub MCP read tools can list threads and comments
- You want to resolve the thread when possible, but still allow merge readiness if resolution is not possible and the thread is acknowledged in-thread

## Preconditions

- You know the PR number
- You can poll review threads with `mcp_io_github_git_pull_request_read` using `method: "get_review_comments"`
- You can identify the top-level review comment ID for the thread you want to reply to

## Preferred Path

- Resolve the thread after verifying the fix.
- Use `gh api graphql` as the first option for thread resolution in this repository.
- If thread resolution cannot be completed with `gh api graphql`, post an in-thread reply explaining what changed.

## Resolve With `gh api graphql`

Use this path as the default and first-choice resolution mechanism in this repo when the thread has been addressed.

Preconditions:

- `gh` is installed
- `gh` is authenticated for the target repository
- You know `owner`, `repo`, `pullNumber`, and the top-level review `commentId`

1. Use `gh api graphql` to find the review-thread node ID that contains the comment.
2. Call the `resolveReviewThread` mutation for that thread ID.
3. If resolution fails, `gh` is unavailable, or the thread ID cannot be found, fall back to the in-thread reply path below.

Example PowerShell sequence:

```powershell
$OWNER = "pwretmo"
$REPO = "deep-underworld"
$PR_NUMBER = <number>
$COMMENT_ID = <top-level review comment id>

$THREAD_ID = gh api graphql `
	-f query='query($owner: String!, $repo: String!, $number: Int!) {
		repository(owner: $owner, name: $repo) {
			pullRequest(number: $number) {
				reviewThreads(first: 100) {
					nodes {
						id
						comments(first: 100) {
							nodes {
								databaseId
							}
						}
					}
				}
			}
		}
	}' `
	-F owner=$OWNER `
	-F repo=$REPO `
	-F number=$PR_NUMBER | ConvertFrom-Json | ForEach-Object {
		$_.data.repository.pullRequest.reviewThreads.nodes |
			Where-Object { $_.comments.nodes.databaseId -contains $COMMENT_ID } |
			Select-Object -ExpandProperty id -First 1
	}

gh api graphql -f query='mutation($threadId: ID!) {
	resolveReviewThread(input: { threadId: $threadId }) {
		thread {
			isResolved
		}
	}
}' -F threadId=$THREAD_ID
```

If this resolution step fails, do not block merge readiness if the feedback is addressed and the in-thread reply was successfully posted.

## Fallback Reply With MCP

If `gh api graphql` cannot resolve the thread, use `mcp_io_github_git_add_reply_to_pull_request_comment` to reply to the top-level comment in the thread. Do not skip the `gh api graphql` attempt when the workflow requires thread resolution.

Example reply:

```
Tool: mcp_io_github_git_add_reply_to_pull_request_comment
Parameters:
	owner: "pwretmo"
	repo: "deep-underworld"
	pullNumber: <number>
	commentId: <top-level review comment id>
	body: "Addressed in the latest commit: <brief explanation of the fix>."
```

## Addressed-Thread Workflow

1. Poll review threads and identify unresolved blocking threads.
2. Verify the underlying code fix is actually present on the current PR head.
3. Identify the top-level review comment ID for each thread that has been addressed.
4. Attempt to resolve the thread with `gh api graphql` as the first option.
5. If resolution cannot be completed, post a reply in the thread with a brief note that explains what changed.
6. Continue with approval or merge once the feedback is addressed and the thread has either been resolved or acknowledged with the reply.

## Failure Conditions

Stop and report failure if:

- The code fix is not actually present on the current PR head
- You cannot identify the top-level comment ID needed for the reply or the thread lookup
- The in-thread reply could not be posted after thread resolution failed

## Return Format

### On Success

```
THREAD RESOLUTION RESULT: RESOLVED
PR: #<number>

Resolved threads:
- <thread id>
- <thread id>
```

If the fallback reply path was used:

```
THREAD RESOLUTION RESULT: REPLIED
PR: #<number>

Replies:
- comment <id>
```

### On Failure

```
THREAD RESOLUTION RESULT: BLOCKED
PR: #<number>

Reason:
- Could not resolve the thread or post the required in-thread follow-up comment.
```
