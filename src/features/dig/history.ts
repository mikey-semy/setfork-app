import type { Lang } from '@/shared/i18n'

/** То немногое от эксперта, что нужно подписи: кто он и как его зовут. */
export interface NameableExpert {
  id: string
  nameRu: string
  nameEn: string
}

/** Реплика беседы: чья она и, если мастера, — какого именно (`who` = id из ростера). */
export interface HistoryMsg {
  role: 'user' | 'gnome'
  who?: string
  text: string
}

/** Сколько последних реплик уезжает в промпт: беседа личная и обычно короткая. */
export const HISTORY_TAIL = 8
const TEXT_CAP = 400

/**
 * ХВОСТ БЕСЕДЫ ДЛЯ ПРОМПТА — С ИМЕНАМИ ГОВОРИВШИХ.
 *
 * ⚠️ Вся история уходила безличным `GNOME:`, и это ломало ровно то, ради чего человек
 * меняет собеседника. Открыл другую дверь (выбрал мастера руками) или мастер позвал
 * коллегу — новый читал ответы предшественника как СВОИ и продолжал за него. Отсюда и
 * ответы вроде «я не Глоин, а Броккр»: в ленте подпись одна, в промпте — общий голос.
 *
 * Имя берём из ростера по `who` и на языке ответа. Мастера в ростере уже нет (выключен,
 * переименован id) — подписываем нейтрально: это лучше, чем выбросить реплику, потому
 * что без неё разговор теряет звено и следующий ответ повисает в воздухе.
 */
export function formatHistory(messages: HistoryMsg[], roster: NameableExpert[], lang: Lang): string {
  const nameOf = (id?: string) => {
    const x = id ? roster.find((r) => r.id === id) : undefined
    if (!x) return 'GNOME'
    return (lang === 'ru' ? x.nameRu : x.nameEn) || 'GNOME'
  }
  return messages
    .slice(-HISTORY_TAIL)
    .map((m) => `${m.role === 'user' ? 'USER' : nameOf(m.who)}: ${String(m.text).slice(0, TEXT_CAP)}`)
    .join('\n')
}
