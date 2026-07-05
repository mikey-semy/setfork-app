// Golden-сверка READ-портов ListStore: TS-адаптер vs Rust ListRead.
// Обе стороны выдают канонический JSON (camelCase, null-нормализация); avatarRef
// нормализуется в null (TS подписывает imgproxy-URL — недетерминированно).
//
// Запуск:
//   1) Rust: cargo run -- domain-read <owner> <slug> out-rust.json   (в setfork-core)
//   2) TS:   NODE_OPTIONS=--conditions=react-server npx tsx scripts/golden-domain-read.ts <owner> <slug> out-rust.json
// Скрипт печатает OK или первый дифф (путь + значения).
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { listStore } from '../src/features/library/list-store.adapter'
import type { LocaleText, Step, Version } from '../src/core'

const [owner, slug, rustFile] = process.argv.slice(2)
if (!owner || !slug || !rustFile) {
  console.error('usage: golden-domain-read.ts <owner> <slug> <rust.json>')
  process.exit(2)
}

const sortLoc = (l: LocaleText) => {
  const out: Record<string, string> = {}
  for (const k of Object.keys(l).sort()) {
    const v = l[k]
    if (typeof v === 'string') out[k] = v
  }
  return out
}
const jver = (v: Version) => ({
  id: v.id, listId: v.listId, version: v.version, note: v.note,
  commitSha: null, createdAtMs: v.createdAt.getTime(),
})
const jstep = (s: Step) => ({
  id: s.id, versionId: s.versionId, n: s.n,
  title: sortLoc(s.title), desc: sortLoc(s.desc), command: s.command,
  level: s.level, why: sortLoc(s.why), section: sortLoc(s.section),
  subtasks: s.subtasks.map(sortLoc),
  refs: s.refs.map((r) => ({ label: sortLoc(r.label), url: r.url ?? null })),
  imageRef: s.imageRef,
})

function diff(path: string, a: unknown, b: unknown): string | null {
  if (a === b) return null
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path}: length ${a.length} != ${b.length}`
    for (let i = 0; i < a.length; i++) {
      const d = diff(`${path}[${i}]`, a[i], b[i])
      if (d) return d
    }
    return null
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a as object).sort()
    const kb = Object.keys(b as object).sort()
    if (ka.join(',') !== kb.join(',')) return `${path}: keys [${ka}] != [${kb}]`
    for (const k of ka) {
      const d = diff(`${path}.${k}`, (a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])
      if (d) return d
    }
    return null
  }
  return `${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`
}

async function main() {
  const list = await listStore.getBySlug(owner, slug)
  let ts: unknown
  if (!list) {
    ts = { found: false }
  } else {
    const [versions, cur, contributors] = await Promise.all([
      listStore.listVersions(list.id),
      listStore.getVersion(list.id, list.currentVersion),
      listStore.getContributors(list.id),
    ])
    ts = {
      found: true,
      list: {
        id: list.id, ownerId: list.ownerId, slug: list.slug,
        title: sortLoc(list.title), desc: sortLoc(list.desc), tags: list.tags,
        ordered: list.ordered, status: list.status, visibility: list.visibility,
        moderation: list.moderation, moderationReason: list.moderationReason,
        verified: list.verified, pinned: list.pinned, origin: list.origin,
        forkedFromId: list.forkedFromId, currentVersion: list.currentVersion,
        starsCount: list.starsCount, forksCount: list.forksCount, runsCount: list.runsCount,
        repositoryId: list.repositoryId,
        createdAtMs: list.createdAt.getTime(), updatedAtMs: list.updatedAt.getTime(),
      },
      versions: versions.map(jver),
      current: {
        version: cur ? jver(cur.version) : null,
        steps: cur ? cur.steps.map(jstep) : [],
      },
      contributors: contributors.map((c) => ({ handle: c.handle, avatarRef: null, accepted: c.accepted })),
    }
  }

  const rust = JSON.parse(readFileSync(rustFile, 'utf8'))
  const d = diff('$', ts, rust)
  if (d) {
    console.error('MISMATCH:', d)
    process.exit(1)
  }
  console.log(`GOLDEN OK: ${owner}/${slug} — TS adapter == Rust ListRead`)
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
