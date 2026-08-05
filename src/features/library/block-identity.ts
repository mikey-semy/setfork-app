import type { LocaleText } from '@/shared/i18n'

/**
 * Идентичность блока сквозь версии и «содержимое блока» — ОДНО определение на
 * приложение.
 *
 * Зачем модуль. Два правила — «этот блок новой версии есть тот же самый блок»
 * и «его содержимое изменилось» — нужны и структурному диффу, и blame, и merge
 * правок. Копии разъехались: дифф сопоставляет по стабильному `steps.block_id`
 * и сравнивает type/content/needsHuman, а blame остался на схеме первого
 * релиза — сопоставлял блоки по позиции `n` и сравнивал восемь текстовых полей.
 * Отсюда два разных ответа на один вопрос: вставка блока в начало списка делала
 * «изменёнными» все нижние пункты, а смена картинки или payload'а
 * text/poll/video блока не считалась изменением вовсе.
 */

/**
 * Поля блока, образующие его СОДЕРЖИМОЕ (в отличие от идентичности `blockId` и
 * порядка `n`). Ровно они попадают в отпечаток.
 */
export interface BlockContent {
  type: string
  content: Record<string, unknown>
  title: LocaleText
  desc: LocaleText
  command: string
  level: string
  why: LocaleText
  section: LocaleText
  subtasks: LocaleText[]
  refs: { label: LocaleText; url?: string }[]
  hasImage: boolean
  imageKey: string | null
  needsHuman: boolean
  needsHumanAsk: LocaleText
  /** Разрушительный пункт: снять пометку — такое же изменение содержимого, как
   *  правка самой команды (после него скрипт станет исполнять то, что не исполнял). */
  danger: boolean
}

/**
 * Перечень полей отпечатка. `Record<keyof BlockContent, true>` — не украшение:
 * новое поле блока, не внесённое сюда, ломает сборку. Молча выпавшее из
 * отпечатка поле и есть та регрессия, из-за которой blame не замечал ни смены
 * изображения, ни пометки «здесь нужен человек».
 */
const CONTENT: Record<keyof BlockContent, true> = {
  type: true,
  content: true,
  title: true,
  desc: true,
  command: true,
  level: true,
  why: true,
  section: true,
  subtasks: true,
  refs: true,
  hasImage: true,
  imageKey: true,
  needsHuman: true,
  needsHumanAsk: true,
  danger: true,
}

/** Поля содержимого в порядке объявления (порядок фиксирует вид отпечатка). */
export const CONTENT_FIELDS = Object.keys(CONTENT) as (keyof BlockContent)[]

/**
 * Детерминированный JSON: ключи объектов сортируются рекурсивно, порядок
 * массивов сохраняется. jsonb в PostgreSQL и так отдаёт ключи в стабильном
 * порядке, но отпечаток обязан быть устойчив и вне БД — на снимках git, в
 * тестах и на данных, собранных в памяти.
 */
export function stableJson(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    const src = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(src).sort()) out[k] = sortKeys(src[k])
    return out
  }
  return value ?? null
}

/**
 * Отпечаток содержимого блока: равные отпечатки = «пользователь блок не менял».
 * Служебные поля (id строки-снимка, versionId, n) в него не входят: новый снимок
 * той же версии не должен читаться как правка.
 */
export function blockFingerprint(b: BlockContent): string {
  return stableJson(CONTENT_FIELDS.map((f) => b[f] ?? null))
}

/**
 * Фолбэк-ключ сопоставления — для данных без `blockId` (записаны до ADR-0013 или
 * мимо редактора). У шага подпись — заголовок во ВСЕХ локалях (перевод одного
 * языка не делает пункт другим блоком), у презентационного блока — его payload:
 * title у text/image/poll/video пустой, и по нему все такие блоки версии слиплись
 * бы в один ключ, а вставка нового смещала бы сопоставление всех следующих.
 *
 * Пороки фолбэка известны и приняты: переименование читается как «блок заменён»,
 * одинаковые подписи разбираются в порядке следования.
 */
export function blockMatchKey(b: BlockContent): string {
  const type = b.type || 'step'
  return type === 'step' ? `step:${stableJson(b.title)}` : `${type}:${stableJson(b.content)}`
}

/** Найденное соответствие блока в предыдущем наборе. */
export interface BlockMatch {
  i: number
  /** Найден по стабильной идентичности (а не по фолбэк-подписи). */
  byIdentity: boolean
}

/**
 * Сопоставление двух наборов блоков: для каждого блока `to` — его источник в
 * `from` либо `null` (блок новый). Одна строка `from` достаётся не более чем
 * одному блоку `to`: иначе дубли подписей врут в счётчиках диффа и в датах blame.
 *
 * Сопоставление идёт по стабильной идентичности, и только при её отсутствии — по
 * фолбэк-ключу. Общая функция вместо копии в каждом потребителе: расхождение
 * правил сопоставления между диффом и blame — это разные ответы на один вопрос
 * «тот же это блок или другой».
 */
export function matchBlocks<T>(
  from: T[],
  to: T[],
  identity: (b: T) => string | null | undefined,
  fallbackKey: (b: T) => string,
): (BlockMatch | null)[] {
  const byId = new Map<string, number>()
  const byKey = new Map<string, number[]>()
  // Отдельная очередь источников БЕЗ идентичности: только они годятся в
  // фолбэк блоку, у которого идентичность есть.
  const byKeyIdless = new Map<string, number[]>()
  from.forEach((s, i) => {
    const id = identity(s)
    if (id) byId.set(id, i)
    const k = fallbackKey(s)
    byKey.set(k, [...(byKey.get(k) ?? []), i])
    if (!id) byKeyIdless.set(k, [...(byKeyIdless.get(k) ?? []), i])
  })

  const taken = new Set<number>()

  return to.map((s) => {
    const id = identity(s)
    if (id) {
      const i = byId.get(id)
      if (i != null && !taken.has(i)) {
        taken.add(i)
        return { i, byIdentity: true }
      }
    }
    // Фолбэк по подписи. У блока со СВОЕЙ идентичностью источником может быть
    // только блок БЕЗ идентичности: источник с другим blockId — заведомо другой
    // блок, и отдавать его нельзя, иначе вставка одноимённого пункта в смешанные
    // данные отбирает источник у настоящего владельца и меняет местами их даты.
    // Совсем без фолбэка тоже нельзя: первая запись после появления идентичностей
    // читалась бы как «всё удалено и всё добавлено» — весь список переписан заново.
    const queue = (id ? byKeyIdless : byKey).get(fallbackKey(s)) ?? []
    for (const i of queue) {
      if (!taken.has(i)) {
        taken.add(i)
        return { i, byIdentity: false }
      }
    }
    return null
  })
}

/** Блок версии: содержимое + идентичность. */
export interface HistoryBlock extends BlockContent {
  blockId?: string | null
}

/** Снимок блоков одной версии списка. */
export interface VersionBlocks<B extends HistoryBlock> {
  version: number
  blocks: B[]
}

/**
 * История версий → для каждого блока ПОСЛЕДНЕЙ версии номер версии, в которой
 * его содержимое менялось в последний раз (индексы совпадают с `blocks`
 * последней версии).
 *
 * Идём по соседним версиям и тянем дату вперёд по идентичности блока — так же,
 * как `git blame` тянет коммит строки, пока сама строка не изменилась.
 * Перемещение блока меняет его позицию, но не содержимое, поэтому дату не
 * обнуляет; появление блока в версии = изменение в этой версии.
 */
export function lastChangedVersions<B extends HistoryBlock>(history: VersionBlocks<B>[]): number[] {
  const asc = [...history].sort((a, b) => a.version - b.version)
  let prev: B[] = []
  let prevFp: string[] = []
  let prevLast: number[] = []
  let last: number[] = []

  for (const { version, blocks } of asc) {
    const matches = matchBlocks(prev, blocks, (b) => b.blockId, blockMatchKey)
    const fp = blocks.map(blockFingerprint)
    last = blocks.map((_, i) => {
      const hit = matches[i]
      if (!hit) return version // блока в предыдущей версии не было — он здесь появился
      return prevFp[hit.i] === fp[i] ? prevLast[hit.i] : version
    })
    prev = blocks
    prevFp = fp
    prevLast = last
  }
  return last
}
