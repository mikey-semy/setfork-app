import type { GeneratedItem } from '@/shared/ai/generate'
import { cleanText } from './text-input'
import type { ProposedItem } from '@/shared/db'
import type { Lang } from '@/shared/i18n'
import { isRiskyCommand } from '@/core/domain/destructive-command'

/**
 * Единая конвертация шагов на запись: сгенерированный ИИ пункт → ProposedItem →
 * форма для listStore.create/addVersion.
 *
 * Почему в общем модуле: одни и те же две функции были скопированы в
 * features/gardener/service.ts и features/library/actions.ts, и самогенерация стала
 * бы третьей копией. Копии уже разъезжались — в садовнике `section` однажды терялся
 * именно здесь, и секционные списки целиком выпадали из свипа.
 */

/** Пункт от ИИ (плоские строки) → ProposedItem (LocaleText по языку списка). */
export function toProposed(items: GeneratedItem[], lang: Lang): ProposedItem[] {
  // Текст приводится к канонической форме ЗДЕСЬ: это общий вход состава для веба, MCP и
  // генерации, и «ё» в составной форме иначе доезжает до базы как другая строка
  // (см. shared/lib/text-input).
  return items.map((it) => ({
    title: { [lang]: cleanText(it.title) },
    desc: cleanText(it.desc) ? { [lang]: cleanText(it.desc) } : {},
    command: cleanText(it.command),
    hasImage: false,
    level: it.level ?? 'required',
    why: cleanText(it.why) ? { [lang]: cleanText(it.why) } : {},
    // Пометка «здесь нужен человек» переносится ВМЕСТЕ с вопросом: без вопроса это
    // просто «мы не знаем», с вопросом — приглашение ответить из опыта.
    ...(it.needsHuman ? { needsHuman: true, needsHumanAsk: cleanText(it.needsHumanAsk) ? { [lang]: cleanText(it.needsHumanAsk) } : {} } : {}),
    section: cleanText(it.section) ? { [lang]: cleanText(it.section) } : {},
    subtasks: (it.subtasks ?? []).map((s) => cleanText(s)).filter(Boolean).map((s) => ({ [lang]: s })),
    refs: (it.refs ?? [])
      .filter((r) => cleanText(r.label))
      .map((r) => ({ label: { [lang]: cleanText(r.label) }, ...(cleanText(r.url) ? { url: cleanText(r.url) } : {}) })),
  }))
}

/**
 * НУМЕРУЕТ ИНТЕРФЕЙС, А НЕ ТЕКСТ.
 *
 * Порядковый номер пункта рисует карточка, номер секции — оглавление. Модель об этом не
 * знала и писала его ещё и в сам заголовок: «1. Подтверждение оповещения» в секции, под
 * которой оглавление ставит свою единицу. Выходила двойная нумерация, и она же ломалась
 * при перестановке пункта — номер в тексте остаётся прежним, а порядок уже другой.
 *
 * Снимаем на ЗАПИСИ, а не при показе: показ бы лечил симптом на одном экране, а тот же
 * текст уехал бы в экспорт, в поиск и в предложение правки. Место одно на все пути записи
 * (редактор, генерация, садовник, MCP) — по той же причине, что и остальное в этом модуле.
 *
 * Форма узкая намеренно: номер, затем точка/скобка/двоеточие, затем ПРОБЕЛ. «1.5 л воды»
 * и «7 способов» так не срежутся — там за разделителем нет пробела либо нет разделителя.
 */
const ORDINAL_PREFIX = /^\s*(?:(?:шаг|step)\s+)?\d{1,3}\s*[.):\]]\s+(?=\S)/i

/** Заголовок без ведущего номера. Пустая строка и текст без номера возвращаются как есть. */
export const stripOrdinal = (s: string): string => s.replace(ORDINAL_PREFIX, '')

/** То же по всем языкам LocaleText: заголовок переведён, номер продублирован в каждом. */
const withoutOrdinal = <T extends Record<string, string | undefined> | undefined>(t: T): T =>
  (t ? (Object.fromEntries(Object.entries(t).map(([k, v]) => [k, typeof v === 'string' ? stripOrdinal(v) : v])) as T) : t)

/** ProposedItem[] → шаги для listStore (нумерация, дефолты type/content). */
export function toStepInput(items: ProposedItem[]) {
  return items.map((it, i) => ({
    n: i + 1,
    type: it.type ?? 'step',
    content: it.content ?? {},
    // Идентичность блока сквозь версии: на ней держатся комментарии к пункту и
    // merge по идентичности. Раньше её переносила только копия конвертера в
    // features/library/actions.ts — а та, в свою очередь, теряла пометку
    // «здесь нужен человек». Обе половины должны жить в ОДНОЙ функции.
    blockId: it.blockId ?? null,
    title: withoutOrdinal(it.title),
    desc: it.desc,
    command: it.command,
    level: it.level,
    why: it.why,
    needsHuman: it.needsHuman ?? false,
    needsHumanAsk: it.needsHumanAsk ?? {},
    // РАЗРУШИТЕЛЬНЫЙ ПУНКТ. Тристейт намеренный: пометка не задана — ставим её по
    // шаблону команды, задана (в т.ч. явным false) — уважаем решение автора.
    // Место одно на все пути записи (редактор, генерация, садовник, MCP): будь
    // авто-простановка в каждом из них, ровно один однажды бы её потерял.
    danger: it.danger ?? isRiskyCommand(it.command),
    section: withoutOrdinal(it.section),
    subtasks: it.subtasks,
    refs: it.refs,
    imageRef: it.imageKey ?? null,
  }))
}
