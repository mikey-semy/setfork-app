# Git compatibility (read-only spike)

Goal: make a SetHub list clonable with **standard git tooling**, with full version history.

## What ships now (verified)

Each list is exposed as a **git bundle** — a single file containing a real repository:

```
GET /{owner}/{slug}/repo.bundle
```

Download it and clone with vanilla git:

```sh
curl -LO https://sethub.app/ops/k8s-rollout/repo.bundle
git clone k8s-rollout.bundle
```

The resulting repo has:

- **one commit per stored version** (`template_versions`), in order, with the
  original author/commit date and the version note as the commit message;
- **a tag per version** (`v1`, `v2`, … — like releases);
- a canonical, diff-friendly working tree:
  - `README.md` — human overview (title, tags, steps rendered as Markdown)
  - `list.json` — machine-readable snapshot (for CI / tooling)
  - `steps/NN-slug.md` — one file per step (front-matter + body)

Because the tree is stable per step, `git diff v1 v3` produces a readable,
file-level diff of the list's evolution.

### Verified end-to-end
- git bundle → `git clone` roundtrip preserves history, tags, dates, files
  (offline test + live endpoint against real multi-version lists).

## Files
- `serialize.ts` — pure: version → canonical file set (`versionFiles`).
- `bundle.ts` — `buildListBundle(owner, slug)` loads history from Postgres,
  materialises a git repo (shells out to the `git` CLI), returns the bundle.
  `bundleFromVersions()` is the DB-free core.
- `CloneBox.tsx` — UI on the list page showing the clone commands.
- route: `app/[handle]/[slug]/repo.bundle/route.ts` (nodejs runtime,
  same privacy checks as the list page).

## Requirements / caveats
- **Requires the `git` binary at runtime** (dev: local git; prod: add git to the
  container image). Without it the endpoint returns 500.
- Builds the repo **per request** — fine for a spike; add caching (by
  `templateId` + `currentVersion`) before heavy use.

## Next steps (not built — need supervision)
1. **Smart-HTTP** so `git clone https://sethub.app/{owner}/{slug}.git` works
   directly (no download step): implement `GET info/refs?service=git-upload-pack`
   + `POST git-upload-pack`, backed by `git http-backend` over the materialised
   repo. Read-only first.
2. **Caching**: persist the built repo / bundle keyed by version; invalidate on
   new version.
3. **Write path** (`git push` → new version): the real bet. Parse pushed tree
   back into steps, validate, create a version. Only after the read path and the
   product model (list-as-repo granularity) are validated.
