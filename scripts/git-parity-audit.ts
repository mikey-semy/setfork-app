/**
 * СВЕРКА «БАЗА ПРОТИВ GIT» по всем спискам.
 *
 * ADR-0014: git — канон содержимого, Postgres — проекция. 19.08 линза ядра 02 измерила, что
 * закон нарушался: правка списка-черновика через MCP шла прямо в Postgres, мимо ядра, и git
 * о ней не узнавал. Путь записи с тех пор один (ADR-0020), но УЖЕ РАСХОШЕДШИЕСЯ списки от
 * этого не выправляются: расхождение всплывёт при первой же публикации — сайт покажет одно,
 * `git clone` отдаст другое.
 *
 * Скрипт только ЧИТАЕТ. Он отвечает на вопрос «сколько списков разошлось и какие», а чинит
 * их обычная запись: любая новая версия рождается через ядро и выравнивает канон.
 *
 *   DATABASE_URL=… SETFORK_CORE_ADDR=… npx tsx --conditions=react-server scripts/git-parity-audit.ts
 *
 * ⚠️ `--conditions=react-server` обязателен: без него `server-only` в цепочке импортов бросает
 * ещё до первой строки работы («cannot be imported from a Client Component»). Проверено
 * запуском, а не предположением.
 *
 * Против прода — через туннель, не с самого прода:
 *   ssh -N -L 15432:127.0.0.1:5432 -L 15051:127.0.0.1:50051 root@<хост>
 *   DATABASE_URL=postgresql://…@127.0.0.1:15432/setfork SETFORK_CORE_ADDR=127.0.0.1:15051 \
 *     npx tsx --conditions=react-server scripts/git-parity-audit.ts
 *
 * Код возврата: 0 — всё сходится, 1 — есть расхождения (годится в гейт).
 */
import { and, asc, eq } from 'drizzle-orm'
import { db, steps, templates, templateVersions, users } from '@/shared/db'
import { gitCore } from '@/features/git/core'

/** Один язык у поля: канон плоский, проекция двуязычная. Сверяем то, что видно. */
const flat = (v: unknown): string =>
  typeof v === 'string' ? v : v && typeof v === 'object' ? String(Object.values(v as Record<string, string>)[0] ?? '') : ''

/** Отпечаток шага: заголовок и команда. Их видно и в клоне, и на странице. */
const fingerprint = (s: { title: unknown; command: unknown }) => `${flat(s.title)} | ${flat(s.command) || ''}`

async function main() {
  const rows = await db
    .select({ id: templates.id, slug: templates.slug, status: templates.status, current: templates.currentVersion, handle: users.handle })
    .from(templates)
    .innerJoin(users, eq(users.id, templates.ownerId))
    .orderBy(asc(templates.slug))

  let checked = 0
  let diverged = 0
  let unreachable = 0
  const bad: string[] = []

  for (const t of rows) {
    const [ver] = await db
      .select({ id: templateVersions.id })
      .from(templateVersions)
      .where(and(eq(templateVersions.templateId, t.id), eq(templateVersions.version, t.current)))
    if (!ver) continue
    const rowsDb = await db
      .select({ title: steps.title, command: steps.command, type: steps.type })
      .from(steps)
      .where(eq(steps.versionId, ver.id))
      .orderBy(asc(steps.n))
    const inDb = rowsDb.filter((s) => (s.type ?? 'step') === 'step').map(fingerprint)

    type Snap = { steps?: { title: unknown; command: unknown; type?: string }[] }
    let snap: Snap | null = null
    try {
      snap = (await gitCore.branchSnapshot({ owner: t.handle, slug: t.slug }, 'main')) as Snap | null
    } catch {
      snap = null
    }
    if (!snap) {
      unreachable++
      console.log(`НЕТ GIT   ${t.handle}/${t.slug} (${t.status}, v${t.current})`)
      continue
    }
    const inGit = (snap.steps ?? []).filter((s) => (s.type ?? 'step') === 'step').map(fingerprint)

    checked++
    if (JSON.stringify(inDb) !== JSON.stringify(inGit)) {
      diverged++
      bad.push(`${t.handle}/${t.slug}`)
      console.log(`РАСХОЖДЕНИЕ ${t.handle}/${t.slug} (${t.status}, v${t.current}): база ${inDb.length} шагов, git ${inGit.length}`)
      for (let i = 0; i < Math.max(inDb.length, inGit.length); i++)
        if (inDb[i] !== inGit[i]) console.log(`    #${i + 1}: база [${(inDb[i] ?? '—').slice(0, 60)}] git [${(inGit[i] ?? '—').slice(0, 60)}]`)
    }
  }

  console.log('')
  console.log(`Проверено: ${checked} · расхождений: ${diverged} · без git-репозитория: ${unreachable}`)
  if (bad.length) {
    console.log('Разошлись:')
    for (const b of bad) console.log(`  ${b}`)
    console.log('Лечение: любая новая версия списка рождается через ядро и выравнивает канон.')
  }
  // Код возврата — чтобы годился в гейт: расхождение это отказ, а не отчёт.
  process.exit(diverged > 0 ? 1 : 0)
}

// Верхнеуровневый await здесь не годится: tsx собирает скрипты в cjs и падает на нём ещё до
// первой строки работы. Проверено запуском, а не предположением.
void main()
