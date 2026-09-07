# Contributing to SetFork

This is the SetFork web application: Next.js and TypeScript in front, Postgres behind,
talking over gRPC to [`setfork-core`](https://github.com/mikey-semy/setfork-core), the
Rust service that owns git.

Before anything else: **this project is maintained by one person.** Pull requests are
reviewed roughly once a week. That is not a promise of speed — it is a promise of an
answer. Silence is worse than a stated wait, so if a week passes without a word, ping
the thread.

## Getting it running

```sh
npm install
cp .env.example .env          # fill in AUTH_SECRET: openssl rand -hex 32
npm run db:up                 # Postgres (pgvector) in Docker, port DB_PORT (5435 by default)
npm run db:init               # schema, extensions and search setup in one command
npm run db:seed               # a public library to look at
npm run dev                   # http://localhost:3000
```

On `/login`, **Continue as demo** works without any external setup.

⚠️ `db:init` pushes the Drizzle schema; do not run the migration files. They are older
than the schema and are kept for history — the schema of record is the Drizzle
definition.

Most of the application works without the Rust core. Anything touching git — versions,
diffs, branches, suggestions — does not.

## Before you write code

Open an issue first for anything beyond an obvious fix. A rejected design costs you an
afternoon; a rejected pull request costs you a week and the maintainer a review.

If your change touches `proto/`, say so: those files are byte-identical copies of the
core's contracts and a gate compares them. A contract change is always a
two-repository change, and the core has to land first.

## AI Contribution Policy

Contributions made with the assistance of AI tools are welcome, but contributors must
use them responsibly and disclose that use clearly.

1. Review AI-generated code closely before marking a pull request ready for review.
2. Manually test the changes and add appropriate automated tests where feasible.
3. Only use AI to assist in contributions that you understand well enough to explain,
   defend, and revise yourself during review.
4. Disclose AI-assisted content clearly.
5. Do not use AI to reply to questions about your issue or pull request. **The questions
   are for you, not an AI model.**
6. AI may be used to help draft issues and pull requests, but contributors remain
   responsible for the accuracy, completeness, and intent of what they submit.

Maintainers reserve the right to close pull requests and issues that do not disclose AI
assistance, that appear to be low-quality AI-generated content, or where the contributor
cannot explain or defend the proposed changes themselves.

*This policy follows [Gitea's](https://github.com/go-gitea/gitea/blob/main/CONTRIBUTING.md).
We keep it for a concrete reason: in January 2026 the curl project shut down its bug
bounty programme because AI-generated reports cost more maintainer time than they were
worth. One maintainer cannot absorb that. SetFork's own audience includes AI agents and
our MCP tools file issues — so the rule that a human stands behind every submission
matters here more than in most projects, not less.*

## Checks

```sh
npm run typecheck
npm run lint
npm run test
npm run build        # run it: type-clean code still fails the build
```

⚠️ **`npm run build` is not optional before pushing.** A change can pass types, lint and
1800 unit tests and still break the build — it happened here with a route setting that
only the production build validates.

`npm run test` is the unit suite. The integration tests run against a real Postgres and
the Rust core, and CI runs them on every pull request:

```sh
npm run itest:env            # brings both up, then prints the command to run
```

⚠️ Note the `itest:env` database is a separate instance on port 55432 — it does not
touch your development one.

### Architecture guards

`tests/architecture/` holds 26 rules that are not about behaviour but about not
repeating a defect we already paid for: one definition per rule, no colour appended to a
button primitive as a template string, no page without a heading, and so on.

If one of them goes red, the message says what it protects and why. Please read it
before working around it — each of those rules exists because something broke in
production.

**When you add a guard, prove it can fail.** Break the rule it guards and watch it go
red. A guard that has never been red guards nothing, and we have shipped two of those.

## Style

- run `npm run lint` and `npm run typecheck`;
- identifiers are Latin-only; comments are in Russian in this repository — keep writing
  them in the language of the file you are editing;
- UI text goes into `src/shared/i18n/dict/{ru,en}.ts`, not inline;
- reuse the primitives in `src/shared/ui/` instead of hand-rolling a button or a badge —
  a hand-rolled one drifts, and we have found the same drift four times.

## Developer Certificate of Origin (DCO)

We consider the act of contributing to the code by submitting a Pull Request as the
"Sign off" or agreement to the certifications and terms of the
[DCO](https://developercertificate.org). Adding the `Signed-off-by` line with
`git commit -s` is appreciated but optional.

⚠️ A Contributor License Agreement is required before a first external pull request is
merged into [`setfork-core`](https://github.com/mikey-semy/setfork-core), not here. If
your change spans both repositories, that applies to the core half of it.

## License

By contributing you agree that your work is licensed under
[AGPL-3.0-only](LICENSE), the licence of this repository.

⚠️ AGPL section 13 applies to network use: anyone interacting with a modified version
over a network must be able to obtain its source. If you run a modified SetFork as a
service, that obligation is yours — a link in the footer is the usual way to meet it.

## Security

Do not report vulnerabilities as public issues. See [SECURITY.md](SECURITY.md).
