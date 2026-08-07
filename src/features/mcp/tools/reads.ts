import 'server-only'
import { eq } from 'drizzle-orm'
import { db, templates, users } from '@/shared/db'
import { tr, trKey } from '@/shared/i18n'
// eslint-disable-next-line no-restricted-imports -- MCP: доступ по userId токена (нет cookie-сессии/админа), canViewList на месте у каждого вызова
import { getDraft, getFeed, getTemplateDetail } from '@/features/library/queries'
import { buildScript, dialectExt, normalizeDialect, toExportList } from '@/features/library/export'
import { getCourseCompletion } from '@/features/quizzes/queries'
import { blockForMcp, mcpCanView, SITE_URL, type DetailStep } from './shared'
import { isCollaborator } from '@/features/collab/queries'

/**
 * Чтения через MCP: поиск, полный список с блоками, готовый скрипт прогона.
 *
 * Отдельно от записи: у чтений нет побочных эффектов и своя причина меняться — форма
 * ответа агенту. Проверка доступа при этом общая, из shared.
 */

export async function mcpSearch(userId: string, query: string, limit: number) {
  const feed = await getFeed({ q: query }, userId)
  return {
    query,
    count: Math.min(feed.length, limit),
    results: feed.slice(0, limit).map((f) => ({
      ref: `${f.ownerHandle}/${f.slug}`,
      title: tr(f.title, 'en'),
      desc: tr(f.desc, 'en'),
      tags: f.tags,
      version: f.version,
      stars: f.starsCount,
      verified: f.verified,
    })),
  }
}


/** Блоки списка в форме MCP: та же форма у чтения и у входа записи — на ней
 *  держится и круг «прочитал → отдал обратно», и точечный патч. */
const blocksForMcp = (rows: DetailStep[]) => rows.map((s) => ({ ...blockForMcp(s), section: tr(s.section, 'en') || undefined }))

export async function mcpGetList(userId: string, handle: string, slug: string) {
  const detail = await getTemplateDetail(handle, slug)
  if (!detail) return null
  const { tpl, currentVersion, steps } = detail
  // Тот же единый предикат приватности, что и на сайте (у MCP админа нет).
  if (!(await mcpCanView(tpl, userId))) return null

  // Свои НЕОПУБЛИКОВАННЫЕ правки показываем рядом с опубликованным составом: без
  // этого агент, начавший копить пачку (patch_list с publish:false), на следующем
  // чтении не видел бы своей работы и патчил бы вслепую.
  // pendingEdits показываем ТОЛЬКО тому, кто может писать: у бывшего соавтора
  // черновик может остаться, а подсказка «call publish_draft» ему уже недоступна.
  const canWrite = tpl.ownerId === userId || (await isCollaborator(tpl.id, userId))
  const pending = canWrite ? await getDraft(tpl.id, userId) : null
  return {
    ref: `${handle}/${slug}`,
    title: tr(tpl.title, 'en'),
    desc: tr(tpl.desc, 'en'),
    tags: tpl.tags,
    ordered: tpl.ordered,
    version: currentVersion?.version ?? tpl.currentVersion,
    verified: tpl.verified,
    // Все блоки списка (шаги + текст/картинки/опросы/видео/тесты) — полный контекст.
    // section = заголовок урока/секции (для контекста границ уроков у AI).
    steps: blocksForMcp(steps),
    ...(pending
      ? {
          pendingEdits: {
            baseVersion: pending.baseVersion,
            blocks: pending.items.length,
            updatedAt: pending.updatedAt.toISOString(),
            // Номер блока проставляем сами: у доменной формы поля n нет, и без него
            // агент не сопоставил бы черновик с опубликованным составом.
            steps: blocksForMcp(pending.items.map((it, i) => ({ ...it, n: i + 1 })) as unknown as Parameters<typeof blocksForMcp>[0]),
            hint: 'these edits are NOT published; patch them further with publish:false or call publish_draft',
          },
        }
      : {}),
  }
}

// get_script: тот же список, но как готовый исполняемый скрипт (bash/ps1/py) —
// удобно агенту, который прогоняет список (CI-for-AI). Приватность как у get_list.
//
// bids — АДРЕСА пунктов (те же, что отдаёт get_list): справочник на тридцать
// пунктов не надо тащить целиком ради одного. Пустой список = весь список, как
// раньше. Неизвестный адрес — ошибка, а не тихий пропуск: агент должен узнать,
// что взял не тот пункт, а не получить скрипт «почти из того, что просил».
export async function mcpGetScript(
  userId: string,
  handle: string,
  slug: string,
  dialectRaw?: string,
  bids?: string[],
) {
  const detail = await getTemplateDetail(handle, slug)
  if (!detail) return null
  const { tpl } = detail
  if (!(await mcpCanView(tpl, userId))) return null

  const dialect = normalizeDialect(dialectRaw)
  const rawUrl = `${SITE_URL}/${handle}/${slug}/raw`
  const list = toExportList(detail)
  const only = (bids ?? []).map((b) => b.trim()).filter(Boolean)
  const known = new Set(list.steps.flatMap((s) => (s.bid ? [s.bid] : [])))
  const unknown = only.filter((b) => !known.has(b))
  if (unknown.length) return { error: `no such block in ${handle}/${slug}: ${unknown.join(', ')}` }

  const { script, included, skipped } = buildScript(list, 'en', rawUrl, dialect, { only })
  const params = new URLSearchParams()
  if (dialect !== 'sh') params.set('lang', dialect)
  only.forEach((b) => params.append('bid', b))
  const qs = params.toString()
  return {
    ref: `${handle}/${slug}`,
    dialect,
    filename: `${slug}.${dialectExt(dialect)}`,
    url: qs ? `${rawUrl}?${qs}` : rawUrl,
    note: 'Commands come from the list authors — review before running.',
    script,
    included,
    // Разрушительные пункты приезжают закомментированными — про это обязан знать
    // и вызывающий: иначе он сочтёт команду выполненной.
    ...(skipped.length
      ? { skipped, skippedNote: 'these steps are commented out in the script — run them yourself after reviewing' }
      : {}),
  }
}
