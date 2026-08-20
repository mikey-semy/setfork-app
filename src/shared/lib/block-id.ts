// Идентичность блока: проверка и генерация. Живёт в shared, а не в features/library,
// потому что её просит ОБЩИЙ конвертер записи (shared/lib/step-input), а слой shared
// импортировать features не может (границы: app → widgets → features → core/shared).
// Копия вместо переезда рано или поздно разъехалась бы — ровно то, о чём предупреждает
// шапка step-input.

/** Годится ли строка в steps.block_id — колонка типа uuid. Идентичность приходит
 *  и снаружи (API), а мусор в этом поле роняет ВСТАВКУ шагов: у черновика она
 *  идёт после удаления старых, и падение оставило бы список пустым. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isBlockUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v)

/** Стабильный id блока — живёт ВНУТРИ content (content.bid) у не-step блоков.
 *  Даёт идентичность для three-way merge: правка text/image — modify, а не add+remove.
 *  Хранение внутри content = ноль правок схемы/proto/Rust (content round-trip'ится
 *  опрозрачно). Генерится один раз при создании блока в редакторе. */
export function newBlockId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (c?.randomUUID) return c.randomUUID()
  // Запасной генератор тоже обязан давать UUID: тот же id уходит в колонку
  // block_id типа uuid, и «b7x3k…» из прежнего фолбэка ронял бы вставку шагов.
  // Случайность здесь слабее, но идентичность блока — не секрет и не ключ.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = Math.floor(Math.random() * 16)
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}
