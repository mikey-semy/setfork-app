// Перекладка ключей языка у списка (ADR-0030): чистая часть скрипта rekey-list-lang.ts.
//
// Отдельным модулем по той же причине, что migrate-drops.ts: скрипт лезет в базу и в ядро,
// а правило «что переложить, что оставить» должно быть покрыто обычным юнит-тестом.
//
// Откуда берётся работа. До исправления MCP (setfork-app#1033) шаги списков, созданных
// агентом, ложились под `en` при любом языке — у русского списка `{ en: 'Замочить горох' }`.
// Язык списка потом проставил бэкфилл, а ключи остались: сайт считает такой текст английским
// переводом, кнопка «Перевести» — уже переведённым на английский.

type LocaleText = Partial<Record<string, string>>

/** Поле, которое можно переложить: один непустой ключ, и это не язык списка. */
export type FieldVerdict = 'keep' | 'move' | 'ambiguous'

/**
 * Что делать с одним многоязычным полем.
 *
 * - пусто или уже есть ключ языка списка — не трогаем (`keep`);
 * - ровно один ключ, и он чужой — это и есть оригинал, записанный не под тем ключом (`move`);
 * - несколько ключей, и среди них нет языка списка — какой из них оригинал, по данным не
 *   сказать; переводить догадку в факт нельзя, поле остаётся как есть и попадает в отчёт.
 */
export function fieldVerdict(v: LocaleText | null | undefined, lang: string): FieldVerdict {
  const keys = Object.keys(v ?? {}).filter((k) => (v ?? {})[k])
  if (!keys.length || keys.includes(lang)) return 'keep'
  return keys.length === 1 ? 'move' : 'ambiguous'
}

export interface RekeyTally {
  moved: number
  ambiguous: number
}

/** Переложить одно поле; счёт ведётся в `tally`. */
function rekeyText<T extends LocaleText | null | undefined>(v: T, lang: string, tally: RekeyTally): T {
  const verdict = fieldVerdict(v, lang)
  if (verdict === 'ambiguous') tally.ambiguous++
  if (verdict !== 'move') return v
  tally.moved++
  const [value] = Object.values(v as LocaleText).filter(Boolean)
  return { [lang]: value } as T
}

/** Многоязычное поле внутри `content` (текст блока, подпись картинки) — бывает и строкой. */
function rekeyLoose(v: unknown, lang: string, tally: RekeyTally): unknown {
  return v && typeof v === 'object' && !Array.isArray(v) ? rekeyText(v as LocaleText, lang, tally) : v
}

/** Блок в доменной форме: только поля, которые здесь читаются. */
export interface RekeyBlock {
  title?: LocaleText
  desc?: LocaleText
  why?: LocaleText
  needsHumanAsk?: LocaleText
  section?: LocaleText
  subtasks?: LocaleText[]
  refs?: { label?: LocaleText; url?: string }[]
  content?: Record<string, unknown> | null
}

/**
 * Переложить ключи во ВСЕХ многоязычных полях блока. Остальное — как было: блок пишется
 * новой версией целиком, и потерянное здесь поле пропало бы из списка.
 */
export function rekeyBlock<T extends RekeyBlock>(block: T, lang: string, tally: RekeyTally): T {
  const out = { ...block }
  for (const f of ['title', 'desc', 'why', 'needsHumanAsk', 'section'] as const) {
    if (f in block) (out as RekeyBlock)[f] = rekeyText(block[f], lang, tally)
  }
  if (block.subtasks) out.subtasks = block.subtasks.map((s) => rekeyText(s, lang, tally))
  if (block.refs) out.refs = block.refs.map((r) => (r.label ? { ...r, label: rekeyText(r.label, lang, tally) } : r))
  if (block.content) {
    const c = { ...block.content }
    for (const k of ['md', 'caption'] as const) if (k in c) c[k] = rekeyLoose(c[k], lang, tally)
    out.content = c
  }
  return out
}

/** Весь список: блоки плюс заголовок и описание самого списка. */
export function rekeyList<T extends RekeyBlock>(
  list: { lang: string; title: LocaleText; desc: LocaleText; blocks: T[] },
): { blocks: T[]; title?: LocaleText; desc?: LocaleText; tally: RekeyTally } {
  const tally: RekeyTally = { moved: 0, ambiguous: 0 }
  const blocks = list.blocks.map((b) => rekeyBlock(b, list.lang, tally))
  const metaTally: RekeyTally = { moved: 0, ambiguous: 0 }
  const title = rekeyText(list.title, list.lang, metaTally)
  const desc = rekeyText(list.desc, list.lang, metaTally)
  tally.moved += metaTally.moved
  tally.ambiguous += metaTally.ambiguous
  // Мету отдаём, ТОЛЬКО если она меняется: патч меты, отсутствующее поле ядро не трогает.
  return {
    blocks,
    ...(title !== list.title ? { title } : {}),
    ...(desc !== list.desc ? { desc } : {}),
    tally,
  }
}
