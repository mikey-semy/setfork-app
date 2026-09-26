// ПЕРЕКЛАДКА КЛЮЧЕЙ ЯЗЫКА у списков (ADR-0030) — план и применение.
//
// Списки, созданные через MCP до setfork-app#1033, хранят текст под `en` при любом языке:
// у русского списка `{ en: 'Замочить горох' }`. Сайт считает такой текст английским переводом,
// кнопка «Перевести» — уже переведённым. Скрипт перекладывает однозначные поля под язык списка.
//
// Запись — ТОЛЬКО через ядро, новой версией (writeProposed — тот же путь, что у MCP): прямой
// UPDATE по steps развёл бы базу с git, а версия с понятной подписью видна в истории списка.
//
// Порядок работы: без флага — только план (ничего не пишет), его показывают владельцу; с
// `--apply` — применение, и план пересчитывается заново: между показом и применением список
// мог измениться. Повторный запуск ничего не делает — перекладывать уже нечего.
//
// Модулем, а не сценарием: функции зовёт итест. Точка входа — rekey-list-lang-run.ts.
import { eq, isNotNull } from 'drizzle-orm'
import { db, listDrafts, templates } from '../src/shared/db'
import { detailByRef } from '../src/features/mcp/tools/shared'
import { rowsToProposed } from '../src/features/mcp/tools/lists/patch-block'
import { ownedList, writeProposed } from '../src/features/mcp/tools/lists/write'
import { isContentLang } from '../src/shared/i18n/iso639'
import { rekeyList } from './rekey-lang'

export const REKEY_NOTE = 'Ключи языка приведены к языку списка (ADR-0030)'

export interface RekeyPlanRow {
  ref: string
  lang: string
  version: number
  moved: number
  ambiguous: number
  translated: number
  /** Список переводили — не перекладывается (см. rekeyList). */
  held: boolean
  sample?: string
}

/** Только списки с настоящим кодом языка: `{ '': текст }` или `{ 'ru-RU': текст }` tr не найдёт. */
async function candidates() {
  const rows = await db.select({ id: templates.id, lang: templates.lang, ownerId: templates.ownerId }).from(templates).where(isNotNull(templates.lang))
  return rows.flatMap((r) => (isContentLang(r.lang) ? [{ ...r, lang: r.lang }] : []))
}

/** Что перекладывается и что остаётся спорным, по каждому списку с языком. Ничего не пишет. */
export async function planRekey(): Promise<RekeyPlanRow[]> {
  const plan: RekeyPlanRow[] = []
  for (const { id, lang } of await candidates()) {
    const found = await prepare(id, lang)
    if (found && found.tally.moved) plan.push(found.row)
  }
  return plan.sort((a, b) => a.ref.localeCompare(b.ref))
}

/** Состав списка после перекладки. null — списка нет (удалён между запросами). */
async function prepare(id: string, lang: string) {
  const tpl = await db.query.templates.findFirst({ where: (t, { eq }) => eq(t.id, id), with: { owner: { columns: { handle: true } } } })
  if (!tpl) return null
  const meta = { slug: tpl.slug, handle: tpl.owner.handle, title: tpl.title, desc: tpl.desc }
  const ref = `${meta.handle}/${meta.slug}`
  const detail = await detailByRef(ref)
  if (!detail) return null
  const r = rekeyList({ lang, title: meta.title, desc: meta.desc, blocks: rowsToProposed(detail.steps) })
  return {
    ref,
    handle: meta.handle,
    slug: meta.slug,
    ...r,
    row: {
      ref,
      lang,
      version: detail.tpl.currentVersion,
      moved: r.tally.moved,
      ambiguous: r.tally.ambiguous,
      translated: r.tally.translated,
      held: r.held,
      ...(r.tally.sample ? { sample: r.tally.sample } : {}),
    },
  }
}

export interface RekeyApplied {
  ref: string
  moved: number
  version?: number
  /** Отказ по этому списку: вердикт ядра, архив, открытый черновик, сбой. */
  error?: string
}

export interface ApplyOptions {
  /** Пауза между записями, мс. Лимит ядра на AddVersion — ОБЩИЙ на весь прод (окно 60 с на
   *  метод, не на клиента: setfork-core/src/ratelimit.rs), и прогон без пауз выбрал бы его
   *  целиком: у живых людей на эту минуту отказывало бы любое сохранение списка. */
  pauseMs?: number
  /** Итог по каждому списку — сразу, а не в конце: оборванный прогон иначе не сказал бы,
   *  что уже переложено. */
  onResult?: (r: RekeyApplied) => void
}

/**
 * Переложить ключи новой версией у каждого списка, где есть что перекладывать. Спорные поля
 * не трогаются; список, где перекладывать нечего, — тоже. Отказ по одному списку — любой,
 * включая сбой ядра или базы, — попадает в итог и не останавливает остальные.
 *
 * Список с ОТКРЫТЫМ ЧЕРНОВИКОМ (рабочая копия редактора или MCP publish:false) пропускается:
 * новая версия сделала бы черновик устаревшим — автор не смог бы его опубликовать, а
 * перенесённые вручную тексты вернули бы старые ключи. Такой список переложит повторный запуск.
 */
export async function applyRekey(opts: ApplyOptions = {}): Promise<RekeyApplied[]> {
  const rows = await candidates()
  const out: RekeyApplied[] = []
  const report = (r: RekeyApplied) => {
    out.push(r)
    opts.onResult?.(r)
  }
  let wrote = false
  for (const { id, lang, ownerId } of rows) {
    let p: Awaited<ReturnType<typeof prepare>> = null
    try {
      p = await prepare(id, lang)
      if (!p || !p.tally.moved || p.held) continue
      const [draft] = await db.select({ id: listDrafts.templateId }).from(listDrafts).where(eq(listDrafts.templateId, id)).limit(1)
      if (draft) {
        report({ ref: p.ref, moved: p.tally.moved, error: 'open draft — skipped, run again after it is published or discarded' })
        continue
      }
      const owned = await ownedList(ownerId, p.handle, p.slug)
      if ('error' in owned) {
        report({ ref: p.ref, moved: p.tally.moved, error: owned.error })
        continue
      }
      const { tpl } = owned
      if (wrote && opts.pauseMs) await new Promise((r) => setTimeout(r, opts.pauseMs))
      wrote = true
      const res = await writeProposed(
        tpl,
        p.handle,
        p.slug,
        p.blocks,
        REKEY_NOTE,
        { tags: tpl.tags, ordered: tpl.ordered, ...(p.title ? { title: p.title } : {}), ...(p.desc ? { desc: p.desc } : {}) },
        // Версия, от которой собран СОСТАВ, а не перечитанная позже: правка автора, легшая
        // между чтениями, иначе прошла бы сверку и была бы молча откачена составом от старой.
        p.row.version,
      )
      report('error' in res ? { ref: p.ref, moved: p.tally.moved, error: res.error } : { ref: p.ref, moved: p.tally.moved, version: res.version })
    } catch (e) {
      report({ ref: p?.ref ?? id, moved: p?.tally.moved ?? 0, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return out.sort((a, b) => a.ref.localeCompare(b.ref))
}
