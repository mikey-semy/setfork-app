# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| `master` | yes |
| latest release | yes |
| anything older | no |

There is one deployment and one maintainer. Fixes land on `master`; older revisions are
not patched.

SetFork runs as a hosted service at [setfork.com](https://setfork.com). A vulnerability
in the running service is in scope even if you found it without reading the code.

## Reporting a vulnerability

**Do not open a public issue.** A public report tells everyone about the hole before it
is closed.

Two ways, in order of preference:

1. **[Private security advisory](../../security/advisories/new)** on GitHub — preferred.
   It needs no mailbox on our side and keeps the discussion attached to the code.
2. **support@setfork.com** — if you would rather write email.

One report per vulnerability, please. Two issues in one thread lose one of them.

Useful in a report: what you did, what happened, what you expected, and why it matters.
A proof of concept helps more than a severity score.

## What we promise

**We answer within a week.**

⚠️ This is a deliberate departure from our reference projects: neither Gitea nor
Mastodon promises a response time, and for a project with a team that is the sensible
choice. We promise one anyway, because SetFork has a single maintainer — and with one
person, silence is indistinguishable from "it never arrived". A stated wait you can
plan around; silence you cannot.

We promise an answer, not a fix. What the answer contains — a fix, a timeline, or a
reasoned "this is not a vulnerability" — depends on the report.

## AI-assisted reports

If a tool helped you find or describe the issue, say so. We will not reject a report for
that, and disclosure costs you nothing.

⚠️ Please write the report yourself. Generated security reports are the reason the curl
project shut down its bug bounty programme in January 2026: the volume was
indistinguishable from real findings until a human had read every one, and one
maintainer cannot do that. A short report in your own words is worth more to us than a
long generated one, and it will be answered faster.
