# Issue tracker: GitHub

Issues and specs live in GitHub Issues for
`amassias/OpenSky-Flight-Tracking`. Use the `gh` CLI from this clone.

## Operations

- Create: `gh issue create --title "..." --body-file <file>`
- Read: `gh issue view <number> --json number,title,body,labels,comments`
- List: `gh issue list --state open`
- Comment: `gh issue comment <number> --body-file <file>`
- Label: `gh issue edit <number> --add-label "..." --remove-label "..."`
- Close: `gh issue close <number> --comment "..."`

Use Markdown files for multiline bodies.

When a skill says "publish to the issue tracker", create a GitHub issue.
When it says "fetch the relevant ticket", read the GitHub issue.

## Relationships

Use native GitHub sub-issues and issue dependencies when available.
Otherwise, record `Part of #<parent>` and `Blocked by: #<number>`
in the issue body.

## Pull requests as a triage surface

**PRs as a request surface: no.**
