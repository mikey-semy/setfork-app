# Git compatibility

Goal: make a SetHub list clonable with **standard git tooling** (git CLI, VS Code),
with full version history.

## Smart-HTTP — direct `git clone` (verified)

```sh
git clone https://sethub.app/ops/k8s-rollout.git
```

Works from the git CLI and **VS Code** (Clone Repository → paste the URL). Read-only
(`git-upload-pack`): clone / fetch / pull. Implemented as a catch-all route
`app/[handle]/[slug]/[...git]/route.ts` that shells out to
`git upload-pack --stateless-rpc` over a freshly materialised repo. Commit SHAs are
deterministic (fixed author + dates), so the stateless per-request rebuild between
`info/refs` and `upload-pack` stays consistent.

- **Public lists**: anonymous clone.
- **Private / draft**: HTTP Basic auth — any username, password = a SetHub **API
  token** (`shub_…`, created in Settings). `git`/VS Code will prompt; we answer 401
  with `WWW-Authenticate: Basic`.
- **Push** (`git-receive-pack`) → `403` for now (see next steps).

`smart-http.ts` holds the pkt-line advertisement + `upload-pack` process glue
(supports protocol v2 via the `Git-Protocol` header and gzipped request bodies).

## Bundle — offline single-file clone (verified)

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

## Next steps
1. **Caching**: repo is rebuilt per request (fine for small lists). Persist the
   materialised repo keyed by `templateId` + `currentVersion`; invalidate on new
   version. Needed before heavy traffic.
2. **Write path** (`git push` → new version): the real bet. Accept
   `git-receive-pack`, capture the pushed pack, diff the tree back into steps,
   validate, and create a new version (author = pushing token's user, must be the
   owner or a collaborator). Reject non-fast-forward / malformed trees. This closes
   the loop for full VS Code editing.
3. **SSH** (optional): `git@sethub.app:owner/slug.git` via an SSH endpoint keyed on
   uploaded public keys. HTTPS + token already covers VS Code, so lower priority.
