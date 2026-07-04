// Демо-«мир»: несколько вымышленных пользователей со списками на разные темы,
// issues между ними, форк, звёзды и подписки — чтобы витрина выглядела живой и
// показывала соц-фичи. НЕ трогает реальных юзеров (mikey-semy) и общий demo-логин
// — работает только со своим набором DEMO_HANDLES. Идемпотентно: все FK на users —
// onDelete cascade, поэтому удаление demo-юзеров чисто сносит весь их след.
//
// Запуск (dev):  npx tsx scripts/seed-demo.ts
// Прод:          на сервере в контейнере app/migrate с тем же DATABASE_URL.
import 'dotenv/config'
import { inArray, eq, sql } from 'drizzle-orm'
import { db, users, templates, templateVersions, steps, issues, stars, watches, follows } from '../src/shared/db'

type Step = { t: string; d?: string; c?: string }
type List = { owner: string; slug: string; title: string; desc: string; ordered?: boolean; tags: string[]; steps: Step[] }
type Issue = { list: string; by: string; title: string; body?: string; labels: string[]; closed?: boolean }

const USERS = [
  { handle: 'alice-ops', name: 'Alice Chen', bio: 'Platform engineer. Docker, Kubernetes, CI/CD.', location: 'Berlin' },
  { handle: 'bob-backend', name: 'Bob Martins', bio: 'Backend developer and unrepentant Postgres nerd.', location: 'Lisbon' },
  { handle: 'dana-sec', name: 'Dana Ivanova', bio: 'AppSec engineer. Hardening things for a living.', location: 'Tallinn' },
  { handle: 'evan-sre', name: 'Evan Wright', bio: 'SRE. On-call survivor. Runbooks or it did not happen.', location: 'Austin' },
  { handle: 'mira-data', name: 'Mira Kaur', bio: 'Data / analytics engineer. Pipelines and data quality.', location: 'Toronto' },
]
const DEMO_HANDLES = USERS.map((u) => u.handle)

// slug'и уникальны в рамках владельца; для ссылок из issues/stars используем owner/slug.
const LISTS: List[] = [
  {
    owner: 'alice-ops', slug: 'kubernetes-deployment-checklist', ordered: true,
    title: 'Kubernetes deployment checklist',
    desc: 'What every Deployment should have before it goes to production.',
    tags: ['kubernetes', 'devops', 'production'],
    steps: [
      { t: 'Set resource requests and limits', d: 'Without them the scheduler guesses and noisy neighbours starve you.', c: 'resources:\n  requests: { cpu: 100m, memory: 128Mi }\n  limits:   { cpu: 500m, memory: 512Mi }' },
      { t: 'Add liveness and readiness probes', d: 'Readiness gates traffic; liveness restarts a wedged pod.' },
      { t: 'Define a PodDisruptionBudget', d: 'Keeps a minimum of replicas during node drains.' },
      { t: 'Pin the image by digest, not :latest' },
      { t: 'Set rollingUpdate maxUnavailable/maxSurge', c: 'strategy: { rollingUpdate: { maxUnavailable: 0, maxSurge: 1 } }' },
      { t: 'Wire a HorizontalPodAutoscaler if load varies' },
    ],
  },
  {
    owner: 'alice-ops', slug: 'ci-pipeline-essentials', ordered: false,
    title: 'CI pipeline essentials',
    desc: 'The minimum a CI pipeline should do before you trust a green check.',
    tags: ['ci', 'devops', 'testing'],
    steps: [
      { t: 'Cache dependencies between runs', d: 'Turns a 6-minute install into 30 seconds.' },
      { t: 'Fail fast: lint and typecheck before tests' },
      { t: 'Run the full test suite on every PR' },
      { t: 'Build the production artifact in CI', d: 'A build that only works on your laptop is a liability.' },
      { t: 'Block merge on required checks' },
    ],
  },
  {
    owner: 'bob-backend', slug: 'postgres-backup-and-restore', ordered: true,
    title: 'PostgreSQL backup and restore',
    desc: 'A backup you have never restored is not a backup. Do this end to end.',
    tags: ['postgres', 'backup', 'database', 'ops'],
    steps: [
      { t: 'Take a logical dump in custom format', c: 'pg_dump -Fc -d $DB > db-$(date -u +%Y%m%d).dump' },
      { t: 'Store it off the database host', d: 'Same-host backups die with the host.' },
      { t: 'Verify the dump restores on a scratch instance', c: 'pg_restore --clean --if-exists -d scratch db-*.dump' },
      { t: 'Automate it on a schedule (cron)' },
      { t: 'Document RPO/RTO and test monthly' },
    ],
  },
  {
    owner: 'bob-backend', slug: 'rest-api-versioning', ordered: false,
    title: 'REST API versioning that will not bite you',
    desc: 'Ship changes without breaking existing clients.',
    tags: ['api', 'backend', 'design'],
    steps: [
      { t: 'Never change the meaning of an existing field' },
      { t: 'Add, do not mutate: new fields are optional' },
      { t: 'Version in the path for breaking changes', c: '/v1/orders → /v2/orders' },
      { t: 'Deprecate with a sunset header and a date' },
      { t: 'Document the contract and keep it tested' },
    ],
  },
  {
    owner: 'dana-sec', slug: 'web-app-security-baseline', ordered: false,
    title: 'Web app security baseline',
    desc: 'The non-negotiable controls for any app facing the internet.',
    tags: ['security', 'web', 'appsec'],
    steps: [
      { t: 'Enforce HTTPS and set HSTS' },
      { t: 'Set a Content-Security-Policy', d: 'The single most effective XSS mitigation.', c: "Content-Security-Policy: default-src 'self'" },
      { t: 'Validate and encode all user input/output' },
      { t: 'Use parameterized queries everywhere', d: 'Never build SQL by string concatenation.' },
      { t: 'Rate-limit auth and other abusable endpoints' },
      { t: 'Keep dependencies patched (automate it)' },
    ],
  },
  {
    owner: 'dana-sec', slug: 'secrets-management', ordered: false,
    title: 'Secrets management done right',
    desc: 'Keep credentials out of git, logs, and error trackers.',
    tags: ['security', 'secrets', 'ops'],
    steps: [
      { t: 'Never commit secrets — scan the repo', c: "git grep -nE '(secret|password|api[_-]?key|token)\\s*='" },
      { t: 'Inject secrets via the environment, not files in the image' },
      { t: 'Rotate on a schedule and after any exposure' },
      { t: 'Scope tokens to least privilege' },
      { t: 'Redact secrets from logs and Sentry' },
    ],
  },
  {
    owner: 'evan-sre', slug: 'on-call-onboarding', ordered: true,
    title: 'On-call onboarding',
    desc: 'Get a new engineer ready to hold the pager without dread.',
    tags: ['sre', 'oncall', 'incident'],
    steps: [
      { t: 'Grant access to dashboards, logs, and the paging tool' },
      { t: 'Walk through the top 5 past incidents' },
      { t: 'Do a shadow rotation before going solo' },
      { t: 'Know how to roll back a deploy in under 5 minutes' },
      { t: 'Know the escalation path and who to wake up' },
    ],
  },
  {
    owner: 'evan-sre', slug: 'defining-good-slos', ordered: false,
    title: 'Defining good SLOs',
    desc: 'Service level objectives that reflect user pain, not vanity metrics.',
    tags: ['sre', 'reliability', 'observability'],
    steps: [
      { t: 'Pick SLIs from the user’s perspective', d: 'Latency and error rate on the paths users actually hit.' },
      { t: 'Set a target that allows an error budget', d: '100% is the wrong target — it forbids all change.' },
      { t: 'Measure over a rolling window (e.g. 28 days)' },
      { t: 'Alert on burn rate, not raw thresholds' },
    ],
  },
  {
    owner: 'mira-data', slug: 'data-pipeline-quality-gates', ordered: false,
    title: 'Data pipeline quality gates',
    desc: 'Catch bad data before it reaches a dashboard or a model.',
    tags: ['data', 'etl', 'quality'],
    steps: [
      { t: 'Assert row counts are within expected bounds' },
      { t: 'Check for nulls in required columns' },
      { t: 'Validate freshness: data is not stale' },
      { t: 'Detect schema drift and fail loudly' },
      { t: 'Quarantine bad rows, do not silently drop them' },
    ],
  },
]

// Форк: evan форкает базовый security-список dana.
const FORKS = [{ owner: 'evan-sre', slug: 'web-app-security-baseline', from: 'dana-sec/web-app-security-baseline' }]

const ISSUES: Issue[] = [
  { list: 'alice-ops/kubernetes-deployment-checklist', by: 'bob-backend', title: 'Add an example for topologySpreadConstraints', body: 'Spreading replicas across zones deserves a step.', labels: ['enhancement'] },
  { list: 'alice-ops/kubernetes-deployment-checklist', by: 'dana-sec', title: 'readinessProbe has no concrete example', body: 'A YAML snippet would make step 2 actionable.', labels: ['docs'] },
  { list: 'alice-ops/kubernetes-deployment-checklist', by: 'evan-sre', title: 'Mention securityContext / runAsNonRoot', labels: ['security', 'enhancement'], closed: true },
  { list: 'bob-backend/postgres-backup-and-restore', by: 'alice-ops', title: 'Cover WAL archiving for point-in-time recovery', body: 'Logical dumps alone give coarse RPO.', labels: ['enhancement'] },
  { list: 'bob-backend/postgres-backup-and-restore', by: 'mira-data', title: 'Clarify -Fc vs plain SQL trade-offs', labels: ['question'] },
  { list: 'dana-sec/web-app-security-baseline', by: 'evan-sre', title: 'A ready-to-copy CSP example would help', body: 'Starter policies are hard to get right.', labels: ['docs'] },
  { list: 'dana-sec/web-app-security-baseline', by: 'bob-backend', title: 'Add a note on secure cookie flags', labels: ['enhancement'] },
  { list: 'evan-sre/on-call-onboarding', by: 'mira-data', title: 'Add a step about updating the runbook after incidents', labels: ['enhancement'] },
  { list: 'bob-backend/rest-api-versioning', by: 'dana-sec', title: 'Path vs header versioning — pick a recommendation', body: 'The list stays neutral; a stance would help readers.', labels: ['question'], closed: true },
  { list: 'mira-data/data-pipeline-quality-gates', by: 'alice-ops', title: 'Great-Expectations vs hand-rolled checks?', labels: ['question'] },
]

// Кто какой список звездит (owner/slug).
const STARS: Record<string, string[]> = {
  'alice-ops/kubernetes-deployment-checklist': ['bob-backend', 'dana-sec', 'evan-sre', 'mira-data'],
  'bob-backend/postgres-backup-and-restore': ['alice-ops', 'evan-sre', 'mira-data'],
  'dana-sec/web-app-security-baseline': ['alice-ops', 'bob-backend', 'evan-sre'],
  'evan-sre/on-call-onboarding': ['alice-ops', 'dana-sec'],
  'dana-sec/secrets-management': ['bob-backend', 'evan-sre'],
  'mira-data/data-pipeline-quality-gates': ['bob-backend'],
  'alice-ops/ci-pipeline-essentials': ['evan-sre', 'mira-data'],
}
const WATCHES: Record<string, string[]> = {
  'alice-ops/kubernetes-deployment-checklist': ['bob-backend', 'evan-sre'],
  'dana-sec/web-app-security-baseline': ['evan-sre'],
}
const FOLLOWS: [string, string][] = [
  ['bob-backend', 'alice-ops'], ['dana-sec', 'alice-ops'], ['evan-sre', 'dana-sec'],
  ['mira-data', 'bob-backend'], ['alice-ops', 'bob-backend'], ['evan-sre', 'alice-ops'],
]

async function main() {
  console.log('Seeding demo world…')

  // (0) Идемпотентность: сносим прошлый demo-набор (cascade уберёт списки/issues/звёзды/подписки).
  await db.delete(users).where(inArray(users.handle, DEMO_HANDLES))

  // (1) Пользователи
  const uRows = await db.insert(users).values(USERS.map((u) => ({ ...u }))).returning({ id: users.id, handle: users.handle })
  const uid = new Map(uRows.map((r) => [r.handle, r.id]))
  console.log(`  users: ${uRows.length}`)

  // (2) Списки + версия + шаги. Ключ owner/slug → templateId.
  const tid = new Map<string, string>()
  const insertList = async (l: List, opts?: { origin?: 'authored' | 'forked'; forkedFromId?: string }) => {
    const [tpl] = await db.insert(templates).values({
      ownerId: uid.get(l.owner)!, slug: l.slug,
      title: { en: l.title }, desc: { en: l.desc },
      tags: l.tags, ordered: l.ordered ?? true, currentVersion: 1,
      origin: opts?.origin ?? 'authored', forkedFromId: opts?.forkedFromId ?? null,
    }).returning({ id: templates.id })
    const [ver] = await db.insert(templateVersions).values({ templateId: tpl.id, version: 1, note: 'seeded' }).returning({ id: templateVersions.id })
    await db.insert(steps).values(l.steps.map((s, i) => ({
      versionId: ver.id, n: i + 1, title: { en: s.t }, desc: s.d ? { en: s.d } : {}, command: s.c ?? '',
    })))
    tid.set(`${l.owner}/${l.slug}`, tpl.id)
    return tpl.id
  }
  for (const l of LISTS) await insertList(l)
  console.log(`  lists: ${LISTS.length}`)

  // (3) Форки
  for (const f of FORKS) {
    const src = LISTS.find((l) => `${l.owner}/${l.slug}` === f.from)!
    await insertList({ ...src, owner: f.owner, slug: f.slug }, { origin: 'forked', forkedFromId: tid.get(f.from)! })
    await db.update(templates).set({ forksCount: sql`${templates.forksCount} + 1` }).where(eq(templates.id, tid.get(f.from)!))
  }
  console.log(`  forks: ${FORKS.length}`)

  // (4) Issues (номер — по порядку в рамках списка)
  const nextNum = new Map<string, number>()
  for (const is of ISSUES) {
    const t = tid.get(is.list)!
    const n = (nextNum.get(is.list) ?? 0) + 1
    nextNum.set(is.list, n)
    await db.insert(issues).values({
      templateId: t, number: n, authorId: uid.get(is.by)!,
      title: is.title, body: is.body ?? '', labels: is.labels,
      status: is.closed ? 'closed' : 'open', closedAt: is.closed ? new Date() : null,
    })
  }
  console.log(`  issues: ${ISSUES.length}`)

  // (5) Звёзды + счётчик
  for (const [list, fans] of Object.entries(STARS)) {
    const t = tid.get(list)!
    await db.insert(stars).values(fans.map((f) => ({ userId: uid.get(f)!, templateId: t })))
    await db.update(templates).set({ starsCount: fans.length }).where(eq(templates.id, t))
  }
  for (const [list, ws] of Object.entries(WATCHES)) {
    const t = tid.get(list)!
    await db.insert(watches).values(ws.map((w) => ({ userId: uid.get(w)!, templateId: t })))
  }
  await db.insert(follows).values(FOLLOWS.map(([a, b]) => ({ followerId: uid.get(a)!, followingId: uid.get(b)! })))
  console.log(`  stars/watches/follows wired`)

  console.log('Done.')
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
