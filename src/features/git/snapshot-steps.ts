import type { BranchSnapshot } from '@/core'
import type { LocaleText } from '@/shared/i18n'

/**
 * Шаги снапшота git → шейп строк БД (LocaleText-поля) — ОДИН маппинг на приложение.
 *
 * До этого одна и та же раскладка была свёрстана дважды: просмотр списка «на
 * ветке» и дифф правки. Различались они мелочами и уже начали расходиться —
 * в частности, про block_id: в list.json он теперь есть (ADR-0013), и снапшот
 * его несёт, а второй экземпляр маппинга об этом ещё «не знал».
 *
 * Язык. list.json одноязычный, поэтому текст кладём в `en` — это НЕ утверждение
 * «текст английский», а единственная ветка LocaleText, куда его можно положить;
 * `tr()` отдаёт её как фолбэк для любого языка. Отсюда важное следствие: сравнивать
 * снапшот можно только со снапшотом. Дифф «ветка → main» строится по двум
 * снапшотам git, а не «ветка против шагов из БД»: у двуязычного списка вторая
 * сторона отдала бы ru-текст, и весь список выглядел бы заменённым целиком.
 */
export interface SnapshotStepRow {
  id: string
  n: number
  blockId: string | null
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
  imageKey: string | null
  hasImage: boolean
  /** Пометка «здесь нужен человек» — в каноне ЕСТЬ с Ф2a, читается из снимка. */
  needsHuman: boolean
  needsHumanAsk: Record<string, unknown>
  /** Разрушительный пункт — в каноне ЕСТЬ, поэтому из снимка ветки честно виден. */
  danger: boolean
}

export function snapshotSteps(snapshot: BranchSnapshot, idPrefix = 'br'): SnapshotStepRow[] {
  return snapshot.steps.map((s) => ({
    id: `${idPrefix}-${s.n}`,
    n: s.n,
    // Идентичность есть у данных, записанных после ADR-0013; у старых — null,
    // и дифф падает на фолбэк по заголовку.
    blockId: s.blockId ?? null,
    type: s.type ?? 'step',
    content: (s.content ?? {}) as Record<string, unknown>,
    title: { en: s.title },
    desc: { en: s.desc },
    command: s.command,
    level: s.level,
    why: { en: s.why },
    section: { en: s.section },
    subtasks: s.subtasks.map((t) => ({ en: t })),
    refs: s.refs.map((r) => ({ label: { en: r.label }, ...(r.url ? { url: r.url } : {}) })),
    // Картинка живёт в объектном хранилище, но КЛЮЧ канон несёт (Ф2a) — иначе
    // просмотр ветки уверял бы, что скриншота у пункта нет, а он есть.
    imageKey: s.imageKey ?? null,
    hasImage: Boolean(s.imageKey),
    // «Нужен человек» канон тоже несёт с Ф2a. Раньше здесь стояло жёсткое false с
    // пояснением «в git не сериализуется» — правда времён, когда поля в каноне не
    // было; в диффе правки пометка из-за этого пропадала.
    needsHuman: s.needsHuman === true,
    needsHumanAsk: s.needsHumanAsk ? { en: s.needsHumanAsk } : {},
    danger: s.danger === true,
  }))
}
