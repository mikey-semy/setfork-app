/**
 * ШАПКА ИСХОДНОГО `SKILL.md` — то, что у скилла есть сверх имени и описания.
 *
 * Решение владельца 24.09.2026 «блоки — правда, экспорт верный»: импорт раскладывает
 * тело в блоки, а шапку исходника хранит при списке и отдаёт обратно. Иначе скилл,
 * прошедший через SetFork, терял лицензию автора, требования к окружению и свои
 * `metadata`, то есть выходил не тем, что вошёл.
 *
 * Поля — из спецификации Agent Skills (agentskills.io/specification): `license`,
 * `compatibility`, `allowed-tools`, `metadata` (строка → строка). `name` и `description`
 * здесь нет: их несут адрес и описание списка. Ключи `metadata.setfork-*` не храним — их
 * экспорт пишет сам из живого списка, а сохранённые копии устаревали бы с каждой версией.
 */
export interface SkillHeader {
  license?: string
  compatibility?: string
  'allowed-tools'?: string
  metadata?: Record<string, string>
}

const TEXT_KEYS = ['license', 'compatibility', 'allowed-tools'] as const

/** Значение шапки строкой: YAML отдаёт числа и булевы — в `SKILL.md` они снова станут текстом. */
const asText = (v: unknown): string | null => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : null)

/**
 * Шапка из разобранного YAML (без `name`/`description`) → то, что храним, и перечень
 * того, что сохранить не вышло: неизвестный ключ или значение не той формы. Молча не
 * теряется ничего — перечень уходит автору в ответ.
 */
export function pickSkillHeader(raw: Record<string, unknown>): { header: SkillHeader | null; dropped: string[] } {
  const header: SkillHeader = {}
  const dropped: string[] = []
  for (const [key, value] of Object.entries(raw)) {
    if ((TEXT_KEYS as readonly string[]).includes(key)) {
      // `allowed-tools` списком (так пишут скиллы Claude Code) — строкой через пробел, как
      // в спецификации: инструменты те же, форма стандартная.
      const text = key === 'allowed-tools' && Array.isArray(value) && value.every((x) => typeof x === 'string') ? value.join(' ') : asText(value)
      if (text !== null && text.trim()) header[key as (typeof TEXT_KEYS)[number]] = text
      else dropped.push(key)
      continue
    }
    if (key === 'metadata' && value && typeof value === 'object' && !Array.isArray(value)) {
      const meta: Record<string, string> = {}
      for (const [k, v] of Object.entries(value)) {
        if (k.startsWith('setfork-')) continue
        const text = asText(v)
        if (text === null) dropped.push(`metadata.${k}`)
        else meta[k] = text
      }
      if (Object.keys(meta).length) header.metadata = meta
      continue
    }
    dropped.push(key)
  }
  return { header: Object.keys(header).length ? header : null, dropped }
}
