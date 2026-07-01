// Сид публичной библиотеки SetHub. Запуск: npm run db:seed
// Идемпотентно для dev: очищает контентные таблицы и наполняет заново.
import 'dotenv/config'
import {
  db,
  runStepState,
  runs,
  stars,
  steps,
  templateVersions,
  templates,
  topics,
  users,
} from '../src/shared/db'

type Sub = { en: string; ru: string }
type Ref = { en: string; ru: string; url?: string }
type StepSeed = {
  en: string
  ru: string
  ie: string
  ir: string
  c: string
  img?: boolean
  subs?: Sub[]
  refs?: Ref[]
}

const TOPICS = [
  { slug: 'deploy', en: 'Deploy & release', ru: 'Деплой и релиз', color: '#2563eb' },
  { slug: 'incident', en: 'Incident response', ru: 'Инциденты', color: '#dc2626' },
  { slug: 'setup', en: 'Environment setup', ru: 'Настройка среды', color: '#7c3aed' },
  { slug: 'cicd', en: 'CI / CD', ru: 'CI / CD', color: '#0891b2' },
  { slug: 'security', en: 'Security & audit', ru: 'Безопасность', color: '#e11d48' },
  { slug: 'onboarding', en: 'Onboarding', ru: 'Онбординг', color: '#16a34a' },
  { slug: 'k8s', en: 'Kubernetes', ru: 'Kubernetes', color: '#4f46e5' },
  { slug: 'database', en: 'Databases', ru: 'Базы данных', color: '#d97706' },
]

// Полный флагманский чек-лист (порт из SetHub.dc.html steps()).
const DEPLOY_STEPS: StepSeed[] = [
  {
    en: 'Pull the latest main', ru: 'Стянуть свежий main', c: 'git checkout main && git pull --ff-only',
    ie: 'Fast-forward only. Abort the run if history has diverged.',
    ir: 'Только fast-forward. Прерви прогон, если история разошлась.',
    subs: [{ en: 'On branch main', ru: 'Ветка main' }, { en: 'No uncommitted changes', ru: 'Нет незакоммиченных правок' }],
    refs: [{ en: 'Branching guide', ru: 'Гайд по веткам' }],
  },
  {
    en: 'Run the test suite', ru: 'Прогнать тесты', c: 'make test',
    ie: 'The whole suite must be green before you build an image.',
    ir: 'Весь набор тестов должен быть зелёным до сборки образа.',
    subs: [{ en: 'Unit tests green', ru: 'Юнит-тесты зелёные' }, { en: 'Integration green', ru: 'Интеграционные зелёные' }, { en: 'Coverage ≥ 80%', ru: 'Покрытие ≥ 80%' }],
    refs: [{ en: 'CI dashboard', ru: 'Дашборд CI' }],
  },
  {
    en: 'Build the image', ru: 'Собрать образ', c: 'docker build -t app:$(git rev-parse --short HEAD) .', img: true,
    ie: 'Tag the image with the short commit SHA for traceability.',
    ir: 'Тегируй образ коротким SHA коммита для трассируемости.',
    subs: [{ en: 'Dockerfile lint passes', ru: 'Линт Dockerfile прошёл' }, { en: 'Tag = short SHA', ru: 'Тег = короткий SHA' }],
    refs: [{ en: 'Registry', ru: 'Реестр' }, { en: 'Dockerfile', ru: 'Dockerfile' }],
  },
  {
    en: 'Push to the registry', ru: 'Запушить в реестр', c: 'docker push registry.acme.dev/app',
    ie: "Confirm the registry auth token hasn't expired before pushing.",
    ir: 'Убедись, что токен реестра не протух, перед пушем.',
    subs: [{ en: 'Auth token valid', ru: 'Токен авторизации валиден' }, { en: 'All layers pushed', ru: 'Все слои запушены' }],
    refs: [{ en: 'Registry', ru: 'Реестр' }],
  },
  {
    en: 'Back up the database', ru: 'Сделать бэкап БД', c: 'pg_dump "$DATABASE_URL" > backup.sql',
    ie: 'Store the dump off the deploy host, then verify its checksum.',
    ir: 'Сохрани дамп вне деплой-хоста и проверь контрольную сумму.',
    subs: [{ en: 'Dump created', ru: 'Дамп создан' }, { en: 'Stored off-host', ru: 'Сохранён вне хоста' }, { en: 'Checksum verified', ru: 'Сумма проверена' }],
    refs: [{ en: 'Backup policy', ru: 'Политика бэкапов' }],
  },
  {
    en: 'Deploy the stack', ru: 'Развернуть стек', c: 'docker compose up -d', img: true,
    ie: 'Watch the health checks come up green before proceeding.',
    ir: 'Дождись зелёных health-check-ов, прежде чем идти дальше.',
    subs: [{ en: 'Containers up', ru: 'Контейнеры подняты' }, { en: 'Health green', ru: 'Health зелёный' }, { en: 'No restart loops', ru: 'Нет циклов рестарта' }],
    refs: [{ en: 'Compose file', ru: 'Compose-файл' }, { en: 'Grafana', ru: 'Grafana' }],
  },
  {
    en: 'Smoke-test prod', ru: 'Смоук-тест прода', c: 'curl -fsS https://acme.dev/healthz', img: true,
    ie: 'Hit the public health endpoint and walk one key user flow.',
    ir: 'Дёрни публичный health-эндпоинт и пройди один ключевой сценарий.',
    subs: [{ en: '/healthz returns 200', ru: '/healthz отдаёт 200' }, { en: 'Key flow works', ru: 'Ключевой сценарий работает' }],
    refs: [{ en: 'Status page', ru: 'Страница статуса' }],
  },
  {
    en: 'Announce the release', ru: 'Оповестить о релизе', c: 'gh release create v1.4.2 --generate-notes',
    ie: 'Auto-generate notes from merged PRs and post to the channel.',
    ir: 'Сгенерируй заметки из смёрженных PR и запость в канал.',
    subs: [{ en: 'Notes generated', ru: 'Заметки сгенерированы' }, { en: 'Posted to channel', ru: 'Опубликовано в канал' }],
    refs: [{ en: 'Releases', ru: 'Релизы' }],
  },
]

// Короткие шаги для остальных карточек библиотеки.
function simpleSteps(items: [string, string, string][]): StepSeed[] {
  return items.map(([en, ru, c]) => ({ en, ru, c, ie: '', ir: '' }))
}

const LISTS: {
  owner: string
  slug: string
  topic: string
  titleEn: string
  titleRu: string
  descEn: string
  descRu: string
  ver: number
  runs: number
  forks: number
  stars: number
  steps: StepSeed[]
}[] = [
  {
    owner: 'acme', slug: 'deploy-to-vps', topic: 'deploy', ver: 6,
    titleEn: 'Deploy to a VPS', titleRu: 'Деплой на VPS',
    descEn: 'SSH in, pull, run migrations, bring the stack up, smoke-test.',
    descRu: 'SSH, pull, миграции, поднять стек, смоук-тест.',
    runs: 2400, forks: 810, stars: 3100, steps: DEPLOY_STEPS,
  },
  {
    owner: 'sre', slug: 'incident-sev1', topic: 'incident', ver: 9,
    titleEn: 'Sev-1 incident response', titleRu: 'Отработка Sev-1',
    descEn: 'First 15 minutes of a Sev-1: page, triage, mitigate, comms.',
    descRu: 'Первые 15 минут Sev-1: пейдж, триаж, митигация, коммуникации.',
    runs: 1200, forks: 640, stars: 2200,
    steps: simpleSteps([
      ['Page the on-call & open a channel', 'Позвать дежурного и открыть канал', 'gh issue create --label sev1'],
      ['Triage impact & scope', 'Оценить влияние и охват', 'kubectl get pods -A | grep -v Running'],
      ['Apply mitigation / rollback', 'Применить митигацию / откат', 'kubectl rollout undo deploy/app'],
      ['Post status & write the timeline', 'Опубликовать статус и таймлайн', 'echo "postmortem.md"'],
    ]),
  },
  {
    owner: 'mel', slug: 'mac-dev-setup', topic: 'setup', ver: 12,
    titleEn: 'Fresh Mac dev setup', titleRu: 'Настройка dev-Mac',
    descEn: 'Fresh macOS to a working dev machine in a single pass.',
    descRu: 'С чистой macOS до рабочей dev-машины за один проход.',
    runs: 4800, forks: 1900, stars: 6000,
    steps: simpleSteps([
      ['Install Homebrew', 'Установить Homebrew', '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'],
      ['Install core tools', 'Поставить базовые инструменты', 'brew install git node pnpm gh'],
      ['Set up SSH & GitHub', 'Настроить SSH и GitHub', 'ssh-keygen -t ed25519 && gh auth login'],
      ['Clone the monorepo & bootstrap', 'Склонировать монорепу и bootstrap', 'gh repo clone acme/app && pnpm i'],
    ]),
  },
  {
    owner: 'pipe', slug: 'ci-release-flow', topic: 'cicd', ver: 8,
    titleEn: 'CI release flow', titleRu: 'Релиз через CI',
    descEn: 'Tag, build, changelog and publish from one CI run.',
    descRu: 'Тег, сборка, changelog и публикация за один прогон CI.',
    runs: 3300, forks: 1100, stars: 4500,
    steps: simpleSteps([
      ['Bump version & tag', 'Поднять версию и тег', 'npm version minor && git push --tags'],
      ['Build & test in CI', 'Сборка и тесты в CI', 'gh workflow run release.yml'],
      ['Generate the changelog', 'Сгенерировать changelog', 'npx changelogen --release'],
      ['Publish artifacts', 'Опубликовать артефакты', 'npm publish --access public'],
    ]),
  },
  {
    owner: 'sec', slug: 'prod-security-audit', topic: 'security', ver: 3,
    titleEn: 'Prod security audit', titleRu: 'Аудит безопасности прода',
    descEn: 'Quarterly hardening pass across access, secrets and network.',
    descRu: 'Квартальный аудит: доступы, секреты, сеть.',
    runs: 880, forks: 520, stars: 1700,
    steps: simpleSteps([
      ['Review IAM & access', 'Проверить IAM и доступы', 'aws iam generate-credential-report'],
      ['Rotate secrets', 'Ротация секретов', 'vault kv rotate secret/app'],
      ['Scan dependencies', 'Просканировать зависимости', 'npm audit --production'],
      ['Check network exposure', 'Проверить сетевую поверхность', 'nmap -Pn prod.acme.dev'],
    ]),
  },
  {
    owner: 'hr', slug: 'engineer-onboarding', topic: 'onboarding', ver: 5,
    titleEn: 'Engineer onboarding', titleRu: 'Онбординг инженера',
    descEn: 'Day one to week one: access, tools and the first shipped PR.',
    descRu: 'От первого дня до первой недели: доступы, инструменты, первый PR.',
    runs: 2100, forks: 900, stars: 3400,
    steps: simpleSteps([
      ['Grant accounts & access', 'Выдать аккаунты и доступы', 'gh api /orgs/acme/invitations'],
      ['Set up the dev environment', 'Настроить окружение', 'make bootstrap'],
      ['Read the architecture docs', 'Прочитать доки по архитектуре', 'open docs/ARCHITECTURE.md'],
      ['Ship a first small PR', 'Смёржить первый маленький PR', 'gh pr create --fill'],
    ]),
  },
  {
    owner: 'ops', slug: 'k8s-rollout', topic: 'k8s', ver: 6,
    titleEn: 'Zero-downtime k8s rollout', titleRu: 'Раскатка k8s без простоя',
    descEn: 'Zero-downtime rollout with health gates and auto-rollback.',
    descRu: 'Раскатка без простоя с health-гейтами и авто-откатом.',
    runs: 1900, forks: 770, stars: 3000,
    steps: simpleSteps([
      ['Apply the new manifest', 'Применить новый манифест', 'kubectl apply -f deploy.yaml'],
      ['Watch the rollout', 'Следить за раскаткой', 'kubectl rollout status deploy/app'],
      ['Verify health gates', 'Проверить health-гейты', 'kubectl get pods -l app=app'],
      ['Roll back if unhealthy', 'Откатить при проблемах', 'kubectl rollout undo deploy/app'],
    ]),
  },
  {
    owner: 'db', slug: 'postgres-major-upgrade', topic: 'database', ver: 2,
    titleEn: 'Postgres major upgrade', titleRu: 'Мажорный апгрейд Postgres',
    descEn: 'Major-version Postgres upgrade: backup, dry-run, cutover.',
    descRu: 'Мажорный апгрейд Postgres: бэкап, dry-run, переключение.',
    runs: 640, forks: 380, stars: 1200,
    steps: simpleSteps([
      ['Back up the cluster', 'Сделать бэкап кластера', 'pg_dumpall > all.sql'],
      ['Dry-run pg_upgrade', 'Прогнать pg_upgrade вхолостую', 'pg_upgrade --check'],
      ['Cut over & verify', 'Переключиться и проверить', 'pg_upgrade && pg_isready'],
      ['Run ANALYZE', 'Выполнить ANALYZE', 'vacuumdb --all --analyze-in-stages'],
    ]),
  },
]

async function main() {
  console.log('Seeding SetHub library…')

  // Очистка (dev). Порядок — от зависимых к базовым.
  await db.delete(runStepState)
  await db.delete(runs)
  await db.delete(stars)
  await db.delete(steps)
  await db.delete(templateVersions)
  await db.delete(templates)
  await db.delete(topics)
  await db.delete(users)

  // Topics
  const topicRows = await db
    .insert(topics)
    .values(TOPICS.map((t) => ({ slug: t.slug, label: { en: t.en, ru: t.ru }, color: t.color })))
    .returning()
  const topicId = new Map(topicRows.map((t) => [t.slug, t.id]))

  // Owners (по одному на список) + demo.
  const handles = [...new Set(LISTS.map((l) => l.owner))]
  const ownerRows = await db
    .insert(users)
    .values(handles.map((h) => ({ handle: h, name: h })))
    .returning()
  const ownerId = new Map(ownerRows.map((u) => [u.handle, u.id]))

  // Templates + versions + steps
  for (const l of LISTS) {
    const [tpl] = await db
      .insert(templates)
      .values({
        ownerId: ownerId.get(l.owner)!,
        slug: l.slug,
        title: { en: l.titleEn, ru: l.titleRu },
        desc: { en: l.descEn, ru: l.descRu },
        topicId: topicId.get(l.topic) ?? null,
        tags: Array.from(new Set([l.topic, ...l.slug.split('-')])).filter(
          (w) => w.length > 1 && !['to', 'the', 'and', 'of'].includes(w),
        ),
        currentVersion: l.ver,
        origin: 'authored',
        runsCount: l.runs,
        forksCount: l.forks,
        starsCount: l.stars,
      })
      .returning()

    const [ver] = await db
      .insert(templateVersions)
      .values({ templateId: tpl.id, version: l.ver, note: 'seeded' })
      .returning()

    await db.insert(steps).values(
      l.steps.map((s, i) => ({
        versionId: ver.id,
        n: i + 1,
        title: { en: s.en, ru: s.ru },
        desc: { en: s.ie, ru: s.ir },
        command: s.c,
        hasImage: !!s.img,
        subtasks: (s.subs ?? []).map((x) => ({ en: x.en, ru: x.ru })),
        refs: (s.refs ?? []).map((x) => ({ label: { en: x.en, ru: x.ru }, url: x.url })),
      })),
    )
    console.log(`  ✓ ${l.owner}/${l.slug} (v${l.ver}, ${l.steps.length} steps)`)
  }

  console.log(`Done: ${TOPICS.length} topics, ${LISTS.length} lists.`)
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
