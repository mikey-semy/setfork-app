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
import { isNotNull } from 'drizzle-orm'
import { db, templates } from '../src/shared/db'
import { detailByRef } from '../src/features/mcp/tools/shared'
import { rowsToProposed } from '../src/features/mcp/tools/lists/patch-block'
import { ownedList, writeProposed } from '../src/features/mcp/tools/lists/write'
import { headVersion } from '../src/features/mcp/tools/lists/base-version'
import { rekeyList } from './rekey-lang'

export const REKEY_NOTE = 'Ключи языка приведены к языку списка (ADR-0030)'

export interface RekeyPlanRow {
  ref: string
  lang: string
  version: number
  moved: number
  ambiguous: number
}

/** Что перекладывается и что остаётся спорным, по каждому списку с языком. Ничего не пишет. */
export async function planRekey(): Promise<RekeyPlanRow[]> {
  const rows = await db.select({ id: templates.id, lang: templates.lang }).from(templates).where(isNotNull(templates.lang))
  const plan: RekeyPlanRow[] = []
  for (const { id, lang } of rows) {
    const found = await prepare(id, lang!)
    if (found && (found.tally.moved || found.tally.ambiguous)) plan.push(found.row)
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
    row: { ref, lang, version: detail.tpl.currentVersion, moved: r.tally.moved, ambiguous: r.tally.ambiguous },
  }
}

export interface RekeyApplied {
  ref: string
  moved: number
  version?: number
  error?: string
}

/**
 * Переложить ключи новой версией у каждого списка, где есть что перекладывать. Спорные поля
 * не трогаются; список, где перекладывать нечего, — тоже. Отказ по одному списку (архив,
 * заморозка, гонка версий) не останавливает остальные: он попадает в итог.
 */
export async function applyRekey(): Promise<RekeyApplied[]> {
  const rows = await db.select({ id: templates.id, lang: templates.lang, ownerId: templates.ownerId }).from(templates).where(isNotNull(templates.lang))
  const out: RekeyApplied[] = []
  for (const { id, lang, ownerId } of rows) {
    const p = await prepare(id, lang!)
    if (!p || !p.tally.moved) continue
    const owned = await ownedList(ownerId, p.handle, p.slug)
    if ('error' in owned) {
      out.push({ ref: p.ref, moved: p.tally.moved, error: owned.error })
      continue
    }
    const { tpl } = owned
    const res = await writeProposed(
      tpl,
      p.handle,
      p.slug,
      p.blocks,
      REKEY_NOTE,
      { tags: tpl.tags, ordered: tpl.ordered, ...(p.title ? { title: p.title } : {}), ...(p.desc ? { desc: p.desc } : {}) },
      headVersion(tpl),
    )
    out.push('error' in res ? { ref: p.ref, moved: p.tally.moved, error: res.error } : { ref: p.ref, moved: p.tally.moved, version: res.version })
  }
  return out.sort((a, b) => a.ref.localeCompare(b.ref))
}
