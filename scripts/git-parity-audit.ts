/**
 * СВЕРКА «БАЗА ПРОТИВ GIT» по всем спискам.
 *
 * ADR-0014: git — канон содержимого, Postgres — проекция. 19.08 линза ядра 02 измерила, что
 * закон нарушался: правка списка-черновика через MCP шла прямо в Postgres, мимо ядра, и git
 * о ней не узнавал. Путь записи с тех пор один (ADR-0020), но УЖЕ РАСХОШЕДШИЕСЯ списки от
 * этого не выправляются: расхождение всплывёт при первой же публикации — сайт покажет одно,
 * `git clone` отдаст другое.
 *
 * ⚠️ СКРИПТ НЕ ТОЛЬКО ЧИТАЕТ, и это выяснилось на первом же прогоне против прода. Репозитории
 * материализуются ЛЕНИВО: пока список никто не клонировал, репозитория на томе нет вовсе.
 * Запрос снимка его создаёт — из Postgres. На проде 19.08 из 598 списков репозитории имели
 * ПЯТЬ, и один прогон сверки завёл остальные 598 (около 100 МБ на томе).
 *
 * Отсюда главное ограничение метода: у только что материализованного репозитория сверка
 * ТАВТОЛОГИЧНА — git собран из той же базы секунду назад и обязан совпасть. Осмысленный ответ
 * даёт только список, чей репозиторий существовал ДО правки. Поэтому:
 *
 *   ONLY_IDS=<файл со списком id> — сверять лишь эти списки (по одному id в строке).
 *
 * Набор берётся на хосте: имена каталогов на томе ядра — это id списков.
 *   docker exec setfork-core sh -c 'ls /data/git' | sed 's/\.git$//'
 *
 * Чинит расхождение обычная запись: любая новая версия рождается через ядро и выравнивает
 * канон.
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

/**
 * Отпечаток блока — ПО ВСЕМУ содержимому, а не по паре полей.
 *
 * Первая версия сверяла заголовок и команду, и это делало гейт слепым ровно к тому классу
 * потерь, ради которого он заведён: расхождение в описании, секции, ссылках, картинке или
 * пометке «здесь нужен человек» читалось как «совпадает» (находка авто-ревью по #811).
 * Не-step блоки она выбрасывала целиком — то есть текст, опросы и квизы не сверялись вовсе.
 */
const fingerprint = (s: Record<string, unknown>): string =>
  JSON.stringify({
    type: (s.type as string) || 'step',
    title: flat(s.title),
    desc: flat(s.desc),
    command: (s.command as string) || '',
    level: (s.level as string) || '',
    why: flat(s.why),
    section: flat(s.section),
    subtasks: ((s.subtasks as unknown[]) || []).map(flat),
    refs: ((s.refs as { label?: unknown; url?: unknown }[]) || []).map((r) => [flat(r.label), (r.url as string) || '']),
    needsHuman: !!s.needsHuman,
    needsHumanAsk: flat(s.needsHumanAsk),
    danger: !!s.danger,
    image: (s.imageKey as string) || (s.imageRef as string) || '',
    content: s.content ?? {},
  })

async function main() {
  // Ограничение набора: без него прогон МАТЕРИАЛИЗУЕТ все репозитории и сверка становится
  // тавтологичной (см. шапку). Пустое значение — сверять все, осознанно.
  const onlyPath = process.env.ONLY_IDS
  const only = onlyPath
    ? new Set(
        (await import('node:fs')).readFileSync(onlyPath, 'utf8').split('\n').map((x) => x.trim().replace(/\.git$/, '')).filter(Boolean),
      )
    : null
  if (only) console.log(`Сверяем только ${only.size} списков из ${onlyPath}`)
  else console.log('⚠️ Сверяем ВСЕ списки: репозитории, которых нет на томе, будут созданы из базы, и для них сверка тавтологична.')

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
    if (only && !only.has(t.id)) continue
    const [ver] = await db
      .select({ id: templateVersions.id })
      .from(templateVersions)
      .where(and(eq(templateVersions.templateId, t.id), eq(templateVersions.version, t.current)))
    if (!ver) continue
    const rowsDb = await db.select().from(steps).where(eq(steps.versionId, ver.id)).orderBy(asc(steps.n))
    const inDb = rowsDb.map((r) => fingerprint(r as unknown as Record<string, unknown>))

    type Snap = { steps?: Record<string, unknown>[] }
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
    const inGit = (snap.steps ?? []).map(fingerprint)

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
  //
  // НЕДОСТУПНЫЙ git считается отказом наравне с расхождением. Иначе упавшее ядро, сбитая
  // авторизация или пустой ответ давали бы «Проверено: 0 · расхождений: 0» и код 0 — то есть
  // гейт рапортовал бы успех, не сравнив ни одного репозитория (находка авто-ревью по #811).
  if (unreachable > 0) console.log(`⚠️ у ${unreachable} списков не удалось получить снимок git — сверка по ним НЕ выполнена`)
  process.exit(diverged > 0 || unreachable > 0 ? 1 : 0)
}

// Верхнеуровневый await здесь не годится: tsx собирает скрипты в cjs и падает на нём ещё до
// первой строки работы. Проверено запуском, а не предположением.
void main()
