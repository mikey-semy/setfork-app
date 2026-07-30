# Git compatibility — git as source of truth

A SetFork list is a real git repository: **clone, pull, and push** with standard git
tooling (git CLI, VS Code). Git objects are authoritative; the Postgres `steps`/
`template_versions` tables are a projection that keeps the web UI / AI / search working.

## Full round-trip (verified end-to-end)

```sh
git clone https://setfork.com/ops/k8s-rollout.git   # read
# …edit list.json / steps…
git commit -am "tweak step 3" && git push           # write → creates a new version
```

Verified live: clone → edit `list.json` → commit → push creates version N+1 in
Postgres (note = commit message, steps re-projected); the **pushed commit's SHA
persists** on reclone (no divergence); pushing without `list.json` is rejected by a
`pre-receive` hook; a wrong/absent token gets `401`.

- **Read** (`git-upload-pack`): public = anonymous; private/draft = HTTP Basic
  (any username, password = a SetFork **API token** `sf_…` from Settings).
- **Write** (`git-receive-pack`): owner only, Basic auth with an API token.
- **Edit format**: `list.json` at the repo root is the machine-readable source the
  projection parses (`{title, desc, tags, ordered, steps:[…]}`). `README.md` and
  `steps/NN-*.md` are generated views. A pushed commit **must** contain `list.json`.

## Architecture

**Одна реализация: git обслуживает Rust-ядро** (`setfork-core`). Прежняя TS-цепочка
(`core.inproc.ts` → `adapter/store/bundle/project/serialize/smart-http`) удалена в Ф0b:
две реализации одного формата означали побайтовые эталоны и двойную стоимость любой
правки формата. Локальная разработка **требует запущенного ядра**
(`docker compose up core`) — без него git-функции не обслуживаются.

- `core.remote.ts` — Connect-ES клиент к ядру; `core.ts` его экспортирует.
- `list-content.ts` — содержимое версии → форма провода. Канон `list.json` собирает
  ЯДРО: фронт правила формата не знает.
- `http-body.ts` — распаковка gzip у POST-тела (git-клиент вправе сжать).
- Персистентные bare-репо, `pre-receive`, проекция пуша в версии, bundle — всё внутри
  ядра, см. `setfork-core/src/git/`.
- route `app/[handle]/[slug]/[...git]/route.ts` — GET `info/refs` (upload/receive
  advertise) + POST `git-upload-pack` / `git-receive-pack` (push runs receive-pack +
  projection under the repo lock).

## Prod requirements / caveats
- **`git` binary** at runtime (add to the container image).
- **Persistent volume** for `GIT_DATA_DIR` (default `<cwd>/.setfork-git`, gitignored).
  Repos hold pushed commits — losing the volume rebuilds deterministic history from
  Postgres but drops the exact pushed SHAs.
- **Repo lock**: in-process by default. For multi-instance TS deploys sharing one
  `GIT_DATA_DIR` volume, set `GIT_DISTRIBUTED_LOCK=1` to add a Postgres advisory lock
  (per list) on top of the in-proc gate — see `dist-lock.ts`. (The Rust core has its own
  pg advisory lock, so remote-core prod is already covered.)

## Bundle — offline single-file clone (verified)

Each list is exposed as a **git bundle** — a single file containing a real repository:

```
GET /{owner}/{slug}/repo.bundle
```

Download it and clone with vanilla git:

```sh
curl -LO https://setfork.com/ops/k8s-rollout/repo.bundle
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
1. ~~**Distributed lock** for multi-instance push~~ — done (`GIT_DISTRIBUTED_LOCK=1`, see caveat above).
2. **Richer projection**: also parse `steps/NN-*.md` (not just `list.json`) so
   editing the Markdown files directly is honoured; today `list.json` wins.
3. **Collaborators**: allow non-owner write for named collaborators (currently
   owner-only). Ties into a future co-owner/permissions model.
4. **SSH** (optional): `git@setfork.com:owner/slug.git`. HTTPS + token already covers
   VS Code, so lower priority.
