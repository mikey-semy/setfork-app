/**
 * Почему виток генерации не дал списка.
 *
 * Раньше причина жила ТОЛЬКО в логах воркера: человек видел глухое «Не получилось», и
 * переслать нам было нечего — ни модели, ни ответа провайдера. Теперь виток пишет её
 * кодом в реплику 'error', а чат держит свёрнутой: обычному человеку она не нужна, но
 * открыть, прочитать и скопировать он может.
 *
 * Код машинный, подпись рисует UI — как у реплики 'again': причина не протухает в БД
 * при смене языка интерфейса.
 */

export type AiFailCode =
  /** Провайдер не настроен (нет ключа/клиента). */
  | 'no_client'
  /** ИИ выключен в админке. */
  | 'ai_off'
  /** Дневной глобальный кап расхода исчерпан. */
  | 'budget'
  /** Модель ответила, но не списком (не-JSON / пустые пункты). */
  | 'invalid'
  /** Модель не ответила вовремя. */
  | 'timeout'
  /** Сбой вызова: сеть, 5xx провайдера, отказ модели. */
  | 'error'
  /** Упало у нас после ответа модели (запись кандидата и т.п.). */
  | 'internal'
  /** Задача оборвалась вместе с процессом (деплой/OOM) и её похоронила очередь —
   *  никакой виток об этом не отчитался, генерацию закрыл финализатор. */
  | 'lost'

const CODES = new Set<string>(['no_client', 'ai_off', 'budget', 'invalid', 'timeout', 'error', 'internal', 'lost'])

export interface AiFailure {
  code: AiFailCode
  /** Какую модель звали (с `:online`, если был веб-поиск) — половина диагностики. */
  model?: string
  /** Техническая деталь: сообщение провайдера или начало неразобранного ответа. */
  detail?: string
}

// Ключи в текст ошибки провайдера попадают редко, но попадают (эхо заголовка запроса).
// Экран генерации видит только её владелец — и всё же в буфер обмена ключ уезжать не должен.
const SECRETS = /(sk-[A-Za-z0-9_-]{8,})|(Bearer\s+\S+)|((?:api[-_]?key|token|authorization)\s*["':=]+\s*\S+)/gi

/** Причина → строка реплики 'error'. null (причину не поймали) → пусто: «подробностей нет». */
export function serializeFailure(f: AiFailure | null): string {
  if (!f) return ''
  const out: AiFailure = { code: f.code }
  if (f.model) out.model = f.model.slice(0, 120)
  // 600 символов: хватает сообщения провайдера и головы неразобранного ответа, а реплика
  // остаётся строкой, а не простынёй в БД.
  if (f.detail) out.detail = f.detail.trim().replace(SECRETS, '***').slice(0, 600)
  return JSON.stringify(out)
}

/** Строка реплики 'error' → причина. Пусто/чужой формат → null (старые генерации писали ''). */
export function parseFailure(text: string): AiFailure | null {
  const raw = (text ?? '').trim()
  if (!raw.startsWith('{')) return null
  try {
    const o = JSON.parse(raw) as Record<string, unknown>
    const code = String(o.code ?? '')
    if (!CODES.has(code)) return null
    return {
      code: code as AiFailCode,
      model: typeof o.model === 'string' && o.model ? o.model : undefined,
      detail: typeof o.detail === 'string' && o.detail ? o.detail : undefined,
    }
  } catch {
    return null
  }
}
