// Трёхсторонний merge списка по шагам (A4): base = merge-base, ours = main,
// theirs = ветка. Чистая функция без server-only — тестируется в node напрямую.
//
// Идентичность блока — стабильный blockId из list.json, если он там есть
// (ADR-0013); иначе фолбэк: нормализованный title для шага, тип+контент для
// не-step блоков. Дубликаты ключа внутри одной стороны различаются порядковым
// суффиксом. NB: на данных БЕЗ blockId правка text/image по-прежнему выглядит
// как add+remove, а не modify/modify — фолбэк по контенту иначе не умеет.
// Правила (классика three-way, но единица — шаг целиком):
//   изменён только в одной стороне → берём её; в обеих одинаково → берём;
//   в обеих по-разному → КОНФЛИКТ (modified/modified);
//   удалён в одной + изменён в другой → КОНФЛИКТ (delete/modify);
//   удалён и не менялся → удаляем; добавлен → добавляем.
// Порядок результата: ours-порядок; добавленное в theirs — после его
// theirs-предшественника (или в конец).

import { blockIdentity } from '@/core/domain/block-identity'

export interface TwStep {
  // Не-step блоки несут type/content; у шага — undefined (byte-compat).
  type?: string
  content?: Record<string, unknown>
  /** Стабильная идентичность блока сквозь версии — сильнейший ключ для merge.
   *  null = её нет (снапшот git отдаёт именно null, а не отсутствие поля). */
  blockId?: string | null
  title: string
  desc: string
  command: string
  level: string
  why: string
  section: string
  subtasks: string[]
  refs: { label: string; url?: string }[]
}

export interface StepConflict {
  key: string
  kind: 'modified' | 'delete-ours' | 'delete-theirs' // delete-ours = мы удалили, они изменили
  base: TwStep | null
  ours: TwStep | null
  theirs: TwStep | null
}

export interface MetaConflict {
  field: 'title' | 'desc' | 'tags' | 'ordered'
  base: unknown
  ours: unknown
  theirs: unknown
}

export interface TwList {
  title: string
  desc: string
  tags: string[]
  ordered: boolean
  steps: TwStep[]
}

export interface ThreeWayResult {
  /** Шаги-плейсхолдеры конфликтов остаются с маркером key в conflicts. */
  merged: TwList
  conflicts: StepConflict[]
  metaConflicts: MetaConflict[]
  /** Позиция конфликта в merged.steps (для вставки выбора на место). */
  slots: Map<string, number>
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

/**
 * Сравнение блоков — по СОДЕРЖИМОМУ, без идентичности.
 *
 * `blockId` и `content.bid` отвечают на вопрос «тот же это блок», а не «что в
 * нём написано». Пока они входили в сравнение целиком, появление колонки у
 * легаси-блока (её выдаёт редактор при первом же сохранении) читалось как
 * правка содержимого: merge видел, что изменились ОБЕ стороны, и выдавал
 * конфликт там, где ветка правила текст, а main всего лишь получил uuid.
 * То же различение, что в `block-identity.ts`: идентичность отдельно, отпечаток
 * содержимого отдельно. Замечание авто-ревью на fe#769 (P1).
 */
const body = (s: TwStep | null): unknown => {
  if (!s) return s
  const { blockId: _id, content, ...rest } = s
  if (!content) return rest
  const { bid: _bid, ...payload } = content
  return { ...rest, content: payload }
}

const stepEq = (a: TwStep | null, b: TwStep | null): boolean => JSON.stringify(body(a)) === JSON.stringify(body(b))

/** Ключ идентичности блока. Сильнейший — стабильный blockId: с ним
 *  ПЕРЕИМЕНОВАНИЕ шага читается как modify, а не add+remove, и merge перестаёт
 *  выдумывать конфликты там, где просто поправили заголовок. Дальше — легаси
 *  content.bid не-step блоков, затем фолбэк по title/контенту (старые данные). */
function blockKey(s: TwStep): string {
  const c = s.content ?? {}
  const legacy = typeof c.bid === 'string' && c.bid ? c.bid : null
  // ⚠️ Здесь `content.bid` СИЛЬНЕЕ колонки — обратно приоритету `blockIdentity`,
  // и это не описка. Merge сравнивает снимки git, а колонка `block_id` в канон
  // НЕ сериализуется (schema.ts: «В git пока НЕ сериализуется») — значит общий
  // знаменатель всех трёх сторон именно `content.bid`.
  //
  // Без этого переход ломал merge: база сделана до появления колонки и опознана
  // как `text#<legacy>`, а main после первого сохранения — как `id#<uuid>`, хотя
  // несёт тот же legacy-bid. Правка такого блока в ветке давала «добавление» и
  // конфликт удаления вместо одного изменённого блока. Замечание авто-ревью
  // на fe#769 (P1).
  if (legacy) return `${s.type ?? 'step'}#${legacy}`
  if (s.blockId) return `id#${s.blockId}`
  if (!s.type || s.type === 'step') return norm(s.title)
  if (s.type === 'text') return `text:${norm(String(c.md ?? ''))}`
  if (s.type === 'image') return `image:${String(c.ref ?? '')}:${norm(String(c.caption ?? ''))}`
  return `${s.type}:${norm(JSON.stringify(c))}`
}

/** key → block, с суффиксами для дубликатов ключа внутри стороны. */
function keyed(steps: TwStep[]): Map<string, TwStep> {
  const out = new Map<string, TwStep>()
  const seen = new Map<string, number>()
  for (const s of steps) {
    const base = blockKey(s)
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    out.set(n === 1 ? base : `${base}#${n}`, s)
  }
  return out
}

function metaField<T>(field: MetaConflict['field'], base: T, ours: T, theirs: T, conflicts: MetaConflict[]): T {
  const eq = (a: T, b: T) => JSON.stringify(a) === JSON.stringify(b)
  if (eq(ours, theirs)) return ours
  const oursChanged = !eq(ours, base)
  const theirsChanged = !eq(theirs, base)
  if (oursChanged && theirsChanged) {
    conflicts.push({ field, base, ours, theirs })
    return ours // плейсхолдер до выбора
  }
  return theirsChanged ? theirs : ours
}

export function threeWayMerge(base: TwList, ours: TwList, theirs: TwList): ThreeWayResult {
  const metaConflicts: MetaConflict[] = []
  const title = metaField('title', base.title, ours.title, theirs.title, metaConflicts)
  const desc = metaField('desc', base.desc, ours.desc, theirs.desc, metaConflicts)
  const tags = metaField('tags', base.tags, ours.tags, theirs.tags, metaConflicts)
  const ordered = metaField('ordered', base.ordered, ours.ordered, theirs.ordered, metaConflicts)

  const b = keyed(base.steps)
  const o = keyed(ours.steps)
  const t = keyed(theirs.steps)
  const conflicts: StepConflict[] = []
  const merged: TwStep[] = []
  const slots = new Map<string, number>()
  const placed = new Set<string>()

  // Вставка theirs-добавлений: после какого theirs-ключа стоит новый шаг.
  const theirsOrder = [...t.keys()]
  const theirsAdded = theirsOrder.filter((k) => !b.has(k) && !o.has(k))
  const addAfter = new Map<string, string[]>() // ключ-предшественник ('' = в начало) → добавленные
  for (const k of theirsAdded) {
    const i = theirsOrder.indexOf(k)
    // Ближайший предшественник, который есть в ours (иначе в начало/конец).
    let anchor = ''
    for (let j = i - 1; j >= 0; j--) {
      const cand = theirsOrder[j]
      if (o.has(cand) || b.has(cand)) {
        anchor = cand
        break
      }
    }
    const list = addAfter.get(anchor) ?? []
    list.push(k)
    addAfter.set(anchor, list)
  }

  const push = (key: string, step: TwStep | null, conflict?: StepConflict) => {
    if (conflict) {
      slots.set(key, merged.length)
      conflicts.push(conflict)
      // Плейсхолдер: ставим ours-вариант (или theirs при delete-ours) до выбора.
      if (conflict.ours) merged.push(conflict.ours)
      else if (conflict.theirs) merged.push(conflict.theirs)
    } else if (step) {
      merged.push(step)
    }
    placed.add(key)
    for (const added of addAfter.get(key) ?? []) {
      merged.push(t.get(added)!)
      placed.add(added)
    }
  }

  // Добавленные в theirs в самое начало.
  for (const added of addAfter.get('') ?? []) {
    merged.push(t.get(added)!)
    placed.add(added)
  }

  // Основной проход в ours-порядке.
  for (const [key, oursStep] of o) {
    const baseStep = b.get(key) ?? null
    const theirsStep = t.get(key) ?? null
    if (!baseStep) {
      // Добавлен в ours (или в обеих): совпадают → один; разные → конфликт modified.
      if (theirsStep && !stepEq(oursStep, theirsStep)) {
        push(key, null, { key, kind: 'modified', base: null, ours: oursStep, theirs: theirsStep })
      } else {
        push(key, oursStep)
      }
      continue
    }
    if (!theirsStep) {
      // Удалён в theirs.
      if (stepEq(oursStep, baseStep)) push(key, null) // не менялся → удаляем
      else push(key, null, { key, kind: 'delete-theirs', base: baseStep, ours: oursStep, theirs: null })
      continue
    }
    if (stepEq(oursStep, theirsStep)) {
      push(key, oursStep)
    } else if (stepEq(oursStep, baseStep)) {
      push(key, theirsStep) // менялся только theirs
    } else if (stepEq(theirsStep, baseStep)) {
      push(key, oursStep) // менялся только ours
    } else {
      push(key, null, { key, kind: 'modified', base: baseStep, ours: oursStep, theirs: theirsStep })
    }
  }

  // Удалённые в ours: base есть, ours нет.
  for (const [key, baseStep] of b) {
    if (o.has(key) || placed.has(key)) continue
    const theirsStep = t.get(key) ?? null
    if (theirsStep && !stepEq(theirsStep, baseStep)) {
      // Мы удалили, они изменили → конфликт (плейсхолдер = theirs).
      push(key, null, { key, kind: 'delete-ours', base: baseStep, ours: null, theirs: theirsStep })
    }
    // theirs не менял или тоже удалил → остаётся удалённым.
  }

  // Хвост: добавленные в theirs без размещённого якоря.
  for (const k of theirsAdded) {
    if (!placed.has(k)) {
      merged.push(t.get(k)!)
      placed.add(k)
    }
  }

  return { merged: { title, desc, tags, ordered, steps: merged }, conflicts, metaConflicts, slots }
}

export type Choice = 'ours' | 'theirs'

/** Применить выбор пользователя к результату threeWayMerge → финальный список. */
export function applyChoices(
  res: ThreeWayResult,
  stepChoices: Record<string, Choice>,
  metaChoices: Partial<Record<MetaConflict['field'], Choice>>,
): TwList | null {
  // Все конфликты должны быть разрешены.
  for (const c of res.conflicts) if (!stepChoices[c.key]) return null
  for (const m of res.metaConflicts) if (!metaChoices[m.field]) return null

  const steps: (TwStep | null)[] = [...res.merged.steps]
  for (const c of res.conflicts) {
    const pick = stepChoices[c.key] === 'ours' ? c.ours : c.theirs
    const slot = res.slots.get(c.key)
    if (slot === undefined) continue
    if (c.ours || c.theirs) {
      // Плейсхолдер стоит в slot; замещаем выбранным (или помечаем к удалению).
      steps[slot] = pick
    }
  }
  const meta = { title: res.merged.title, desc: res.merged.desc, tags: res.merged.tags, ordered: res.merged.ordered }
  for (const m of res.metaConflicts) {
    const v = metaChoices[m.field] === 'ours' ? m.ours : m.theirs
    ;(meta as Record<string, unknown>)[m.field] = v
  }
  return { ...meta, steps: steps.filter((s): s is TwStep => s !== null) } as TwList
}
