import 'server-only'
import { latestReport } from '@/features/library/verification-report'
import { eq } from 'drizzle-orm'
import { db, templates, users } from '@/shared/db'
import { tr, trKey } from '@/shared/i18n'
// eslint-disable-next-line no-restricted-imports -- MCP: доступ по userId токена (нет cookie-сессии/админа), canViewList на месте у каждого вызова
import { getDraft, getFeed, getTemplateDetail } from '@/features/library/queries'
import { buildScript, scriptRefusal, toExportList } from '@/features/library/export'
import { AUTHORED_DIALECT, dialectExt, normalizeDialect } from '@/core/domain/script-dialect'
import { getCourseCompletion } from '@/features/quizzes/queries'
import { SITE_URL, blockForMcp, detailByRefOrMoved, mcpCanView, type DetailStep } from './shared'
import { isCollaborator } from '@/features/collab/queries'

/**
 * Чтения через MCP: поиск, полный список с блоками, готовый скрипт прогона.
 *
 * Отдельно от записи: у чтений нет побочных эффектов и своя причина меняться — форма
 * ответа агенту. Проверка доступа при этом общая, из shared.
 */

export async function mcpSearch(userId: string, query: string, limit: number) {
  // Сколько просили, столько и запрашиваем. Раньше выдача приезжала целиком и резалась
  // здесь — то есть корпус тянулся ради двадцати строк.
  const feed = await getFeed({ q: query }, userId, undefined, { limit })
  return {
    query,
    count: feed.length,
    results: feed.map((f) => ({
      ref: `${f.ownerHandle}/${f.slug}`,
      title: tr(f.title, 'en'),
      desc: tr(f.desc, 'en'),
      tags: f.tags,
      version: f.version,
      stars: f.starsCount,
    })),
  }
}


/** Блоки списка в форме MCP: та же форма у чтения и у входа записи — на ней
 *  держится и круг «прочитал → отдал обратно», и точечный патч. */
const blocksForMcp = (rows: DetailStep[]) => rows.map((s) => ({ ...blockForMcp(s), section: tr(s.section, 'en') || undefined }))

export async function mcpGetList(userId: string, handle: string, slug: string) {
  const detail = await detailByRefOrMoved(handle, slug)
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
    // Адрес АКТУАЛЬНЫЙ, а не тот, по которому пришли: иначе агент, обратившийся по
    // прежней ссылке, получил бы её же в ответе и продолжил ходить по старому.
    ref: detail.movedTo ?? `${handle}/${slug}`,
    // Пришли по устаревшему адресу — пусть агент обновит свои ссылки (в HTTP это
    // сделал бы 301; в MCP редиректа нет).
    movedTo: detail.movedTo ?? undefined,
    title: tr(tpl.title, 'en'),
    desc: tr(tpl.desc, 'en'),
    tags: tpl.tags,
    ordered: tpl.ordered,
    version: currentVersion?.version ?? tpl.currentVersion,
    /* ⚠️ ПОЛЯ `verified` ЗДЕСЬ НЕТ. Решение 0006: публичного знака проверки не
       существует, потому что видимый публичный список и есть прошедший проверку.
       Отдавать флаг агенту значило бы обещать вторую проверку, которой нет, — и агент
       понесёт это обещание дальше, в свой ответ человеку. */
    /**
     * УРОВЕНЬ ПРОВЕРКИ И ПОСЛЕДНИЙ ОТЧЁТ О ПРОГОНЕ этой версии — то, что агент читает
     * ДО того, как поверить списку. Без них он видит только текст, а текст одинаков у
     * проверенного списка и у собранного вчера из чужой статьи.
     *
     * Отсутствие отчёта — это `null`, а не «не работает»: «не прогоняли» и «прогоняли и
     * не вышло» — разные факты, и подменять один другим нельзя.
     */
    verification: currentVersion
      ? {
          level: currentVersion.verificationLevel,
          verifiedAt: currentVersion.verifiedAt,
          // ⚠️ `canWrite` посчитан выше и обязан доехать сюда: без него агент ВЛАДЕЛЬЦА
          // получал `lastRun: null` там, где сайт показывает провальный отчёт. Одно
          // право — один ответ, независимо от того, человек смотрит или его агент.
          lastRun: await latestReport(currentVersion.id, canWrite).then((r) =>
            r
              ? {
                  verdict: r.verdict,
                  kind: r.kind,
                  task: r.task,
                  environment: r.environment,
                  steps: `${r.steps.filter((x) => x.status === 'pass').length}/${r.steps.length}`,
                  notes: r.notes || undefined,
                  at: r.createdAt,
                }
              : null,
          ),
        }
      : null,
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
  const detail = await detailByRefOrMoved(handle, slug)
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
  // Та же политика, что у /raw: обёртка диалекта не переводит авторские команды,
  // поэтому чужому диалекту они не отдаются. Агенту это важнее, чем человеку: он
  // не читает скрипт глазами и запустит то, что дали.
  if (scriptRefusal(list, dialect, { only })) {
    return {
      error: `no ${dialect} script for ${handle}/${slug}: its steps carry ${AUTHORED_DIALECT} commands, and commands are not translated between languages`,
      dialect: AUTHORED_DIALECT,
    }
  }

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
